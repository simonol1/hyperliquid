// ✅ Deferred TP/SL Worker for Hyperliquid — plugs into your existing logic
import { redis } from '../shared-utils/redis-client.js';
import { logInfo, logError, logDebug, logWarn } from '../shared-utils/logger.js';
import { Hyperliquid } from '../sdk/index.js';
import { retryWithBackoff } from '../shared-utils/retry-order.js';
import { OrderRequest } from '../sdk/index.js';

const hyperliquid = new Hyperliquid();
const subaccountAddress = process.env.HYPERLIQUID_SUBACCOUNT_WALLET!;
if (!subaccountAddress) throw new Error('Missing subaccount wallet env var');

interface DeferredTPSignal {
    coin: string;
    isLong: boolean;
    qty: number;
    entryPx: number;
    pxDecimals: number;
    tpPercents: number[];         // e.g. [1.5, 3, 5]
    runnerPercent: number;        // e.g. 8
    stopLossPercent: number;      // e.g. 2.5
    ts: number;
}

export const processDeferredTP = async () => {
    const keys = await redis.keys('pendingTP:*');
    if (keys.length === 0) return;

    for (const key of keys) {
        try {
            const coin = key.split(':')[1];
            const raw = await redis.get(key);
            if (!raw) continue;

            const data: DeferredTPSignal = JSON.parse(raw);
            const { isLong, qty, entryPx, pxDecimals, tpPercents, runnerPercent, stopLossPercent, ts } = data;

            const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
            const openPosition = perpState.assetPositions.find(p => p.position.coin === coin && parseFloat(p.position?.szi ?? '0') > 0);

            // Ensure the position is open and valid — allow partial fills
            if (!openPosition) {
                if (Date.now() - ts > 60_000) {
                    logWarn(`[DeferredTP] ❌ Expired: ${coin} TP/SL not placed in 60s`);
                    await redis.del(key);
                } else {
                    logDebug(`[DeferredTP] ⏳ Awaiting position open for ${coin}`);
                }
                continue;
            }

            const placedPrices = new Set<number>();
            const numLevels = tpPercents.length;
            const runnerQty = Number((qty * 0.2).toFixed(4));
            const chunkQty = Number(((qty - runnerQty) / numLevels).toFixed(4));

            for (const pct of tpPercents) {
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
                    `Deferred TP @ ${tidyPx}`
                );

                const status = res?.response?.data?.statuses?.[0];
                if (res?.status === 'ok' && status?.status === 'accepted') {
                    logInfo(`[DeferredTP] ✅ TP @ ${tidyPx} qty=${chunkQty}`);
                } else {
                    logError(`[DeferredTP] ❌ TP @ ${tidyPx} failed → ${status?.status ?? 'unknown'}`);
                }
            }

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
                `Deferred Runner TP @ ${runnerPx}`
            );

            const runnerStatus = runnerRes?.response?.data?.statuses?.[0];
            if (runnerRes?.status === 'ok' && runnerStatus?.status === 'accepted') {
                logInfo(`[DeferredTP] 🏃 Runner TP @ ${runnerPx} qty=${runnerQty}`);
            } else {
                logError(`[DeferredTP] ❌ Runner TP @ ${runnerPx} failed → ${runnerStatus?.status ?? 'unknown'}`);
            }

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
                `Deferred SL @ ${stopPxTidy}`
            );

            const slStatus = slRes?.response?.data?.statuses?.[0];
            if (slRes?.status === 'ok' && slStatus?.status === 'accepted') {
                logInfo(`[DeferredTP] 🛑 SL @ ${stopPxTidy} qty=${qty}`);
            } else {
                logError(`[DeferredTP] ❌ SL @ ${stopPxTidy} failed → ${slStatus?.status ?? 'unknown'}`);
            }

            await redis.del(key);
        } catch (err) {
            logError(`[DeferredTP] ❌ Error: ${err}`);
        }
    }
};
