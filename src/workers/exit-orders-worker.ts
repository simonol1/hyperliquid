import { redis } from '../shared-utils/redis-client.js';
import { logInfo, logError, logDebug, logWarn } from '../shared-utils/logger.js';
import { Hyperliquid } from '../sdk/index.js';
import { retryWithBackoff } from '../shared-utils/retry-order.js';
import { OrderRequest } from '../sdk/index.js';
import { updateBotErrorStatus, updateBotStatus } from '../shared-utils/healthcheck.js';
import { buildMetaMap, CoinMeta } from '../shared-utils/coin-meta.js';

const subaccountAddress = process.env.HYPERLIQUID_SUBACCOUNT_WALLET!;
const hyperliquid = new Hyperliquid({
    enableWs: false,
    privateKey: process.env.HYPERLIQUID_AGENT_PRIVATE_KEY!,
    walletAddress: process.env.HYPERLIQUID_AGENT_WALLET!,
    vaultAddress: subaccountAddress,
});
await hyperliquid.connect();

logInfo(`✅ [Exits Bot] Connected to Hyperliquid`);

const MAX_PRICE_SANITY = 100_000;
const PRICE_TOLERANCE_PCT = 20;

// Price rounding helper
const getTidyPx = (price: number, pxDecimals: number): number => {
    const multiplier = Math.pow(10, pxDecimals);
    return Math.round(price * multiplier) / multiplier;
};

interface ExitOrderStatus {
    price: number;
    qty: number;
    placed?: boolean;
}

interface ExitOrdersSignal {
    coin: string;
    isLong: boolean;
    entryPx: number;
    pxDecimals: number;
    szDecimals: number;
    ts: number;
    totalQty: number;
    tpPercents: number[];
    runnerPercent: number;
    stopLossPercent: number;
    tp1: ExitOrderStatus;
    tp2: ExitOrderStatus;
    tp3: ExitOrderStatus;
    runner: ExitOrderStatus;
    sl: ExitOrderStatus;
}

const wasOrderAccepted = (status: any): boolean => {
    return ['accepted', 'resting', 'waitingForTrigger'].includes(status);
};

const metaMap: Map<string, CoinMeta> = await buildMetaMap(hyperliquid);

export const processPendingExitOrders = async () => {
    const keys = await redis.keys('pendingExitOrders:*');
    if (keys.length === 0) {
        logDebug(`[ExitOrders] No pending exit order keys found.`);
        return;
    }

    logDebug(`[ExitOrders] Processing ${keys.length} pending exit order keys.`);

    for (const key of keys) {
        try {
            const coin = key.split(':')[1];
            const raw = await redis.get(key);
            if (!raw) {
                logWarn(`[ExitOrders] Skipping empty key: ${key}`);
                continue;
            }

            const data: ExitOrdersSignal = JSON.parse(raw);
            const { isLong, entryPx, pxDecimals, szDecimals, ts, totalQty, tpPercents, runnerPercent, stopLossPercent } = data;

            const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
            const openPosition = perpState.assetPositions.find(p => p.position.coin === coin && parseFloat(p.position?.szi ?? '0') > 0);
            if (!openPosition) {
                if (Date.now() - data.ts > 90_000) {
                    logWarn(`[ExitOrders] ❌ Expired: ${coin} TP/SL not placed in 60s (position not found). Deleting key.`);
                    await redis.del(key);
                } else {
                    logDebug(`[ExitOrders] ⏳ Awaiting position open for ${coin}. Signal timestamp: ${new Date(data.ts).toISOString()}`);
                }
                continue;
            }

            const currentPositionQty = parseFloat(openPosition.position.szi);
            const minSize = metaMap.get(coin)?.minSize ?? 0;
            const updates: Partial<ExitOrdersSignal> = {};

            const chunkQty = Number((currentPositionQty * 0.25).toFixed(szDecimals));
            const runnerQty = Number((currentPositionQty * 0.25).toFixed(szDecimals));

            const book = await hyperliquid.info.getL2Book(coin);
            const [asks, bids] = book.levels;
            const bestAsk = parseFloat(asks[0].px);
            const bestBid = parseFloat(bids[0].px);
            const currentMarketPrice = (bestAsk + bestBid) / 2;

            const isPriceSane = (calculatedPx: number): boolean => {
                if (calculatedPx <= 0 || calculatedPx > MAX_PRICE_SANITY) return false;
                if (isNaN(currentMarketPrice) || currentMarketPrice === 0) {
                    logWarn(`[ExitOrders] ⚠️ Current market price for ${coin} is invalid (${currentMarketPrice}). Skipping price sanity check.`);
                    return true;
                }
                const deviation = Math.abs((calculatedPx - currentMarketPrice) / currentMarketPrice) * 100;
                return deviation <= PRICE_TOLERANCE_PCT;
            };

            for (let i = 0; i < tpPercents.length; i++) {
                const pct = tpPercents[i];
                const rawPx = isLong ? entryPx * (1 + pct / 100) : entryPx * (1 - pct / 100);
                const tidyPx = getTidyPx(rawPx, pxDecimals);
                const field = `tp${i + 1}` as keyof ExitOrdersSignal;

                if ((data[field] as ExitOrderStatus)?.placed) continue;
                if (chunkQty < minSize || !isPriceSane(tidyPx)) {
                    logError(`[ExitOrders] ❌ Invalid TP${i + 1} for ${coin}: qty=${chunkQty}, px=${tidyPx}`);
                    (updates[field] as ExitOrderStatus) = { price: tidyPx, qty: chunkQty, placed: true };
                    continue;
                }

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

                const res = await retryWithBackoff(() => hyperliquid.exchange.placeOrder(tpOrder), 3, 1000, 2, `TP${i + 1} @ ${tidyPx}`);
                logInfo(JSON.stringify(res?.response?.data))
                const status = res?.response?.data?.statuses?.[0]?.status || JSON.stringify(res?.response?.data?.statuses?.[0]);

                if (wasOrderAccepted(status)) {
                    logInfo(`[ExitOrders] ✅ TP${i + 1} @ ${tidyPx} qty=${chunkQty} is ${status} for ${coin}`);
                    (updates[field] as ExitOrderStatus) = { price: tidyPx, qty: chunkQty, placed: true };
                } else {
                    logError(`[ExitOrders] ❌ TP${i + 1} @ ${tidyPx} failed for ${coin} → ${status}`);
                    (updates[field] as ExitOrderStatus) = { price: tidyPx, qty: chunkQty, placed: false };
                }
            }

            if (!(data.runner as ExitOrderStatus)?.placed) {
                const rawPx = isLong ? entryPx * (1 + runnerPercent / 100) : entryPx * (1 - runnerPercent / 100);
                const runnerPx = getTidyPx(rawPx, pxDecimals);

                if (runnerQty < minSize || !isPriceSane(runnerPx)) {
                    logError(`[ExitOrders] ❌ Invalid runner for ${coin}: qty=${runnerQty}, px=${runnerPx}`);
                    (updates.runner as ExitOrderStatus) = { price: runnerPx, qty: runnerQty, placed: true };
                } else {
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

                    const res = await retryWithBackoff(() => hyperliquid.exchange.placeOrder(runnerOrder), 3, 1000, 2, `Runner TP @ ${runnerPx}`);
                    const status = res?.response?.data?.statuses?.[0]?.status || JSON.stringify(res?.response?.data?.statuses?.[0]);

                    if (wasOrderAccepted(status)) {
                        logInfo(`[ExitOrders] 🏃 Runner TP @ ${runnerPx} qty=${runnerQty} is ${status} for ${coin}`);
                        (updates.runner as ExitOrderStatus) = { price: runnerPx, qty: runnerQty, placed: true };
                    } else {
                        logError(`[ExitOrders] ❌ Runner TP @ ${runnerPx} failed for ${coin} → ${status}`);
                        (updates.runner as ExitOrderStatus) = { price: runnerPx, qty: runnerQty, placed: false };
                    }
                }
            }

            if (!(data.sl as ExitOrderStatus)?.placed) {
                const rawPx = isLong ? entryPx * (1 - stopLossPercent / 100) : entryPx * (1 + stopLossPercent / 100);
                const stopPxTidy = getTidyPx(rawPx, pxDecimals);
                const slQty = Number(currentPositionQty.toFixed(szDecimals));

                if (slQty < minSize || !isPriceSane(stopPxTidy)) {
                    logError(`[ExitOrders] ❌ Invalid SL for ${coin}: qty=${slQty}, px=${stopPxTidy}`);
                    (updates.sl as ExitOrderStatus) = { price: stopPxTidy, qty: slQty, placed: true };
                } else {
                    const slOrder: OrderRequest = {
                        coin,
                        is_buy: !isLong,
                        sz: slQty,
                        limit_px: stopPxTidy,
                        order_type: {
                            trigger: { triggerPx: stopPxTidy, isMarket: true, tpsl: 'sl' },
                        },
                        reduce_only: true,
                        grouping: 'positionTpsl',
                    };

                    const res = await retryWithBackoff(() => hyperliquid.exchange.placeOrder(slOrder), 3, 1000, 2, `SL @ ${stopPxTidy}`);
                    const status = res?.response?.data?.statuses?.[0]?.status || JSON.stringify(res?.response?.data?.statuses?.[0]);

                    if (wasOrderAccepted(status)) {
                        logInfo(`[ExitOrders] 🛑 SL @ ${stopPxTidy} qty=${slQty} is ${status} for ${coin}`);
                        (updates.sl as ExitOrderStatus) = { price: stopPxTidy, qty: slQty, placed: true };
                    } else {
                        logError(`[ExitOrders] ❌ SL @ ${stopPxTidy} failed for ${coin} → ${status}`);
                        (updates.sl as ExitOrderStatus) = { price: stopPxTidy, qty: slQty, placed: false };
                    }
                }
            }

            const updatedSignal: ExitOrdersSignal = { ...data, ...updates };
            const allDone = ['tp1', 'tp2', 'tp3', 'runner', 'sl'].every(f => (updatedSignal[f as keyof ExitOrdersSignal] as ExitOrderStatus)?.placed);

            if (allDone) {
                await redis.del(key);
                logInfo(`[ExitOrders] ✅ All exit orders placed for ${coin}, key cleared.`);
            } else {
                await redis.set(key, JSON.stringify(updatedSignal));
                logWarn(` ⚠️ [ExitOrders] 🔁 Some exit orders pending for ${coin}, will retry.`);
            }

            await updateBotStatus('exits');
        } catch (err: any) {
            logError(`[ExitOrders] ❌ Error processing key ${key}: ${err.message || JSON.stringify(err)}`);
            await updateBotErrorStatus('exits', err);
        }
    }
};

setInterval(processPendingExitOrders, 5000);
