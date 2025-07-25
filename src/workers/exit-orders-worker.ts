import { redis } from '../shared-utils/redis-client.js';
import { logInfo, logError, logDebug, logWarn } from '../shared-utils/logger.js';
import { Hyperliquid } from '../sdk/index.js';
import { retryWithBackoff } from '../shared-utils/retry-order.js';
import { OrderRequest } from '../sdk/index.js';
import { updateBotErrorStatus, updateBotStatus } from '../shared-utils/healthcheck.js';
import { cancelStaleGtc } from '../orders/cancel-gtc.js';

const subaccountAddress = process.env.HYPERLIQUID_SUBACCOUNT_WALLET!;
if (!subaccountAddress) throw new Error('Missing subaccount wallet env var');

const hyperliquid = new Hyperliquid({
    enableWs: false,
    privateKey: process.env.HYPERLIQUID_AGENT_PRIVATE_KEY!,
    walletAddress: process.env.HYPERLIQUID_AGENT_WALLET!,
    vaultAddress: subaccountAddress,
});

await hyperliquid.connect();
logInfo(`✅ [ExitOrders Bot] Connected to Hyperliquid`);

interface ExitOrdersSignal {
    coin: string;
    isLong: boolean;
    qty: number;
    entryPx: number;
    pxDecimals: number;
    tpPercents: number[];
    runnerPercent: number;
    stopLossPercent: number;
    ts: number;

    [key: `tp${number}`]: true | undefined;
    runner?: true;
    sl?: true;
}

const wasOrderAccepted = (res: any): boolean => {
    const status = res?.response?.data?.statuses?.[0];
    return (
        res?.status === 'ok' &&
        (status?.status === 'accepted' || status?.status === 'resting')
    );
};

export const processPendingExitOrders = async () => {
    const keys = await redis.keys('pendingExitOrders:*');
    if (keys.length === 0) return;

    for (const key of keys) {
        try {
            const coin = key.split(':')[1];
            const raw = await redis.get(key);
            if (!raw) continue;

            const data: ExitOrdersSignal = JSON.parse(raw);
            const { isLong, qty, entryPx, pxDecimals, tpPercents, runnerPercent, stopLossPercent, ts } = data;

            const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
            const openPosition = perpState.assetPositions.find(
                p => p.position.coin === coin && parseFloat(p.position?.szi ?? '0') > 0
            );

            if (!openPosition) {
                if (Date.now() - ts > 60_000) {
                    logWarn(`[ExitOrders] ❌ Expired: ${coin} TP/SL not placed in 60s`);
                    await redis.del(key);
                } else {
                    logDebug(`[ExitOrders] ⏳ Awaiting position open for ${coin}`);
                }
                continue;
            }

            await cancelStaleGtc(hyperliquid, coin, subaccountAddress);

            let allSucceeded = true;
            const placedPrices = new Set<number>();
            const numLevels = tpPercents.length;
            const runnerQty = Number((qty * 0.2).toFixed(4));
            const chunkQty = Number(((qty - runnerQty) / numLevels).toFixed(4));

            // TP levels
            for (let i = 0; i < tpPercents.length; i++) {
                const pct = tpPercents[i];
                const key = `tp${i + 1}` as const;
                if (data[key]) continue;

                const rawPx = isLong ? entryPx * (1 + pct / 100) : entryPx * (1 - pct / 100);
                const tidyPx = Number(rawPx.toFixed(pxDecimals));
                if (placedPrices.has(tidyPx)) continue;
                placedPrices.add(tidyPx);

                const tpOrder: OrderRequest = {
                    coin,
                    is_buy: !isLong,
                    sz: chunkQty,
                    limit_px: tidyPx,
                    order_type: {
                        trigger: { triggerPx: tidyPx, isMarket: true, tpsl: 'tp' },
                    },
                    reduce_only: true,
                    grouping: 'positionTpsl',
                };

                const res = await retryWithBackoff(
                    () => hyperliquid.exchange.placeOrder(tpOrder),
                    3,
                    1000,
                    2,
                    `TP @ ${tidyPx}`
                );

                if (wasOrderAccepted(res)) {
                    logInfo(`[ExitOrders] ✅ TP @ ${tidyPx} qty=${chunkQty}`);
                    data[key] = true;
                } else {
                    logError(`[ExitOrders] ❌ TP @ ${tidyPx} failed → ${JSON.stringify(res?.response?.data?.statuses?.[0])}`);
                    allSucceeded = false;
                }
            }

            // Runner TP
            if (!data.runner) {
                const runnerPx = Number(
                    (isLong ? entryPx * (1 + runnerPercent / 100) : entryPx * (1 - runnerPercent / 100)).toFixed(pxDecimals)
                );

                const runnerOrder: OrderRequest = {
                    coin,
                    is_buy: !isLong,
                    sz: runnerQty,
                    limit_px: runnerPx,
                    order_type: {
                        trigger: { triggerPx: runnerPx, isMarket: true, tpsl: 'tp' },
                    },
                    reduce_only: true,
                    grouping: 'positionTpsl',
                };

                const runnerRes = await retryWithBackoff(
                    () => hyperliquid.exchange.placeOrder(runnerOrder),
                    3,
                    1000,
                    2,
                    `Runner TP @ ${runnerPx}`
                );

                if (wasOrderAccepted(runnerRes)) {
                    logInfo(`[ExitOrders] 🏃 Runner TP @ ${runnerPx} qty=${runnerQty}`);
                    data.runner = true;
                } else {
                    logError(`[ExitOrders] ❌ Runner TP @ ${runnerPx} failed → ${JSON.stringify(runnerRes?.response?.data?.statuses?.[0])}`);
                    allSucceeded = false;
                }
            }

            // Stop Loss
            if (!data.sl) {
                const stopPx = isLong
                    ? entryPx * (1 - stopLossPercent / 100)
                    : entryPx * (1 + stopLossPercent / 100);
                const stopPxTidy = Number(stopPx.toFixed(pxDecimals));

                const slOrder: OrderRequest = {
                    coin,
                    is_buy: !isLong,
                    sz: qty,
                    limit_px: stopPxTidy,
                    order_type: {
                        trigger: { triggerPx: stopPxTidy, isMarket: true, tpsl: 'sl' },
                    },
                    reduce_only: true,
                    grouping: 'positionTpsl',
                };

                const slRes = await retryWithBackoff(
                    () => hyperliquid.exchange.placeOrder(slOrder),
                    3,
                    1000,
                    2,
                    `SL @ ${stopPxTidy}`
                );

                if (wasOrderAccepted(slRes)) {
                    logInfo(`[ExitOrders] 🛑 SL @ ${stopPxTidy} qty=${qty}`);
                    data.sl = true;
                } else {
                    logError(`[ExitOrders] ❌ SL @ ${stopPxTidy} failed → ${JSON.stringify(slRes?.response?.data?.statuses?.[0])}`);
                    allSucceeded = false;
                }
            }

            // Check if all exit orders have been placed
            const tpDone = tpPercents.every((_, i) => data[`tp${i + 1}`]);
            if (tpDone && data.runner && data.sl) {
                await redis.del(key);
                logInfo(`[ExitOrders] ✅ All exit orders placed for ${coin}, key cleared`);
            } else {
                await redis.set(key, JSON.stringify(data), { EX: 60 });
                logWarn(`[ExitOrders] 🔁 Some exit orders pending for ${coin}, will retry`);
            }

            await updateBotStatus('exit-orders-worker');
        } catch (err: any) {
            logError(`[ExitOrders] ❌ Error: ${err}`);
            await updateBotErrorStatus('exit-orders-worker', err);
        }
    }
};

setInterval(processPendingExitOrders, 5000);
