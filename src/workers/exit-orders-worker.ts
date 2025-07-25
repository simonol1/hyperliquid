import { redis } from '../shared-utils/redis-client.js';
import { logInfo, logError, logDebug, logWarn } from '../shared-utils/logger.js';
import { Hyperliquid } from '../sdk/index.js';
import { retryWithBackoff } from '../shared-utils/retry-order.js';
import { OrderRequest } from '../sdk/index.js';
import { updateBotErrorStatus, updateBotStatus } from '../shared-utils/healthcheck.js';
import { cancelStaleGtc } from '../orders/cancel-gtc.js';
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

// Maximum price sanity check to prevent erroneous orders
const MAX_PRICE_SANITY = 100_000;
const PRICE_TOLERANCE_PCT = 20; // 20% tolerance

const RUNNER_PCT = 25;

// Interface to track the placement status of an individual exit order (TP/SL/Runner)
interface ExitOrderStatus {
    price: number; // The price at which the order was attempted/placed
    qty: number;   // The quantity for which the order was attempted/placed
    placed?: boolean; // Indicates if this specific order has been successfully placed
}

// Interface for the signal data stored in Redis for pending exit orders
interface ExitOrdersSignal {
    coin: string;
    isLong: boolean;
    entryPx: number;
    pxDecimals: number;
    szDecimals: number;
    ts: number; // Timestamp when the signal was created
    totalQty: number; // The total quantity of the position for which exits are being placed

    // Percentages for Take Profit and Stop Loss levels.
    // IMPORTANT: These should be part of the data stored in Redis for each signal.
    tpPercents: number[];
    stopLossPercent: number;

    // Status of individual exit orders
    tp1: ExitOrderStatus;
    tp2: ExitOrderStatus;
    tp3: ExitOrderStatus;
    runner: ExitOrderStatus;
    sl: ExitOrderStatus;
}

// Helper to check if an order was accepted by Hyperliquid
const wasOrderAccepted = (res: any): boolean => {
    const status = res?.response?.data?.statuses?.[0];
    return res?.status === 'ok' && ['accepted', 'resting', 'waitingForTrigger'].includes(status?.status);
};

// Build the metaMap once at startup
const metaMap: Map<string, CoinMeta> = await buildMetaMap(hyperliquid);

export const processPendingExitOrders = async () => {
    // Get all keys for pending exit orders from Redis
    const keys = await redis.keys('pendingExitOrders:*');
    if (keys.length === 0) {
        logDebug(`[ExitOrders] No pending exit order keys found.`);
        return;
    }

    logDebug(`[ExitOrders] Processing ${keys.length} pending exit order keys.`);

    for (const key of keys) {
        try {
            const coin = key.split(':')[1]; // Extract coin from the Redis key
            const raw = await redis.get(key); // Get the raw signal data from Redis
            if (!raw) {
                logWarn(`[ExitOrders] Skipping empty key: ${key}`);
                continue;
            }

            const data: ExitOrdersSignal = JSON.parse(raw);
            const { isLong, entryPx, pxDecimals, szDecimals, ts, totalQty, tpPercents, stopLossPercent } = data;

            // Fetch current clearinghouse state to find the open position
            const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
            const openPosition = perpState.assetPositions.find(p => p.position.coin === coin && parseFloat(p.position?.szi ?? '0') > 0);

            // If no open position is found for this coin
            if (!openPosition) {
                // If the signal is too old (e.g., position closed or never opened)
                if (Date.now() - data.ts > 60_000) { // 60 seconds expiry
                    logWarn(`[ExitOrders] ❌ Expired: ${coin} TP/SL not placed in 60s (position not found). Deleting key.`);
                    await redis.del(key);
                } else {
                    logDebug(`[ExitOrders] ⏳ Awaiting position open for ${coin}. Signal timestamp: ${new Date(data.ts).toISOString()}`);
                }
                continue; // Skip to the next key
            }

            // Get the current quantity of the open position
            const currentPositionQty = parseFloat(openPosition.position.szi);

            // Determine minimum order size for this coin from metaMap
            const minSize = metaMap.get(coin)?.minSize ?? 0;

            // Object to track updates to the signal's placed status
            const updates: Partial<ExitOrdersSignal> = {};

            // Calculate quantities based on 25% of current position for each TP and runner
            const chunkQty = Number((currentPositionQty * 0.25).toFixed(szDecimals));

            const runnerQty = Number((currentPositionQty * (RUNNER_PCT / 100)).toFixed(szDecimals));

            const book = await hyperliquid.info.getL2Book(coin);
            const [asks, bids] = book.levels;
            const bestAsk = parseFloat(asks[0].px);
            const bestBid = parseFloat(bids[0].px);

            const currentMarketPrice = (bestAsk + bestBid) / 2;

            const isPriceSane = (calculatedPx: number): boolean => {
                if (calculatedPx <= 0 || calculatedPx > MAX_PRICE_SANITY) return false;
                if (isNaN(currentMarketPrice) || currentMarketPrice === 0) {
                    logWarn(`[ExitOrders] ⚠️ Current market price for ${coin} is invalid (${currentMarketPrice}). Skipping price sanity check.`);
                    return true; // Cannot perform sanity check, assume sane for now
                }
                const deviation = Math.abs((calculatedPx - currentMarketPrice) / currentMarketPrice) * 100;
                return deviation <= PRICE_TOLERANCE_PCT;
            };


            // --- Place Take Profit Orders (TP1, TP2, TP3) ---
            for (let i = 0; i < tpPercents.length; i++) {
                const pct = tpPercents[i];
                const tidyPx = Number((isLong ? entryPx * (1 + pct / 100) : entryPx * (1 - pct / 100)).toFixed(pxDecimals));
                const field = `tp${i + 1}` as keyof ExitOrdersSignal;

                // If this TP order has already been placed, skip it
                if ((data[field] as ExitOrderStatus)?.placed) continue;

                // Validate order quantity and price before placing
                if (chunkQty < minSize || !isPriceSane(tidyPx)) {
                    logError(`[ExitOrders] ❌ Invalid TP${i + 1} order for ${coin}: qty=${chunkQty} (minSize=${minSize}), px=${tidyPx} (sane=${isPriceSane(tidyPx)}). Skipping.`);
                    (updates[field] as ExitOrderStatus) = { price: tidyPx, qty: chunkQty, placed: true };
                    continue;
                }

                const tpOrder: OrderRequest = {
                    coin,
                    is_buy: !isLong, // Opposite of position direction
                    sz: chunkQty,
                    limit_px: tidyPx,
                    order_type: {
                        trigger: { triggerPx: tidyPx, isMarket: true, tpsl: 'tp' },
                    },
                    reduce_only: true, // Only reduce existing position
                    grouping: 'positionTpsl', // Group orders for easy cancellation
                };

                const res = await retryWithBackoff(() => hyperliquid.exchange.placeOrder(tpOrder), 3, 1000, 2, `TP${i + 1} @ ${tidyPx}`);
                const statusMessage = res?.response?.data?.statuses?.[0]?.status || JSON.stringify(res?.response?.data?.statuses?.[0]);

                if (wasOrderAccepted(res)) {
                    logInfo(`[ExitOrders] ✅ TP${i + 1} @ ${tidyPx} qty=${chunkQty} is ${statusMessage} for ${coin}`);
                    (updates[field] as ExitOrderStatus) = { price: tidyPx, qty: chunkQty, placed: true };
                } else {
                    logError(`[ExitOrders] ❌ TP${i + 1} @ ${tidyPx} failed for ${coin} → ${statusMessage}`);
                    (updates[field] as ExitOrderStatus) = { price: tidyPx, qty: chunkQty, placed: false };
                }
            }

            // --- Place Runner Take Profit Order ---
            if (!(data.runner as ExitOrderStatus)?.placed) {
                const runnerPx = Number((isLong ? entryPx * (1 + RUNNER_PCT / 100) : entryPx * (1 - RUNNER_PCT / 100)).toFixed(pxDecimals));

                // Validate runner order quantity and price
                if (runnerQty < minSize || !isPriceSane(runnerPx)) {
                    logError(`[ExitOrders] ❌ Invalid runner order for ${coin}: qty=${runnerQty} (minSize=${minSize}), px=${runnerPx} (sane=${isPriceSane(runnerPx)}). Marking as skipped.`);
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
                    const statusMessage = res?.response?.data?.statuses?.[0]?.status || JSON.stringify(res?.response?.data?.statuses?.[0]);

                    if (wasOrderAccepted(res)) {
                        logInfo(`[ExitOrders] 🏃 Runner TP @ ${runnerPx} qty=${runnerQty} is ${statusMessage} for ${coin}`);
                        (updates.runner as ExitOrderStatus) = { price: runnerPx, qty: runnerQty, placed: true };
                    } else {
                        logError(`[ExitOrders] ❌ Runner TP @ ${runnerPx} failed for ${coin} → ${statusMessage}`);
                        (updates.runner as ExitOrderStatus) = { price: runnerPx, qty: runnerQty, placed: false };
                    }
                }
            }

            // --- Place Stop Loss Order ---
            if (!(data.sl as ExitOrderStatus)?.placed) {
                const stopPxTidy = Number((isLong ? entryPx * (1 - stopLossPercent / 100) : entryPx * (1 + stopLossPercent / 100)).toFixed(pxDecimals));

                // Validate SL order quantity and price. SL typically covers full position.
                const slQty = Number(currentPositionQty.toFixed(szDecimals));

                if (slQty < minSize || !isPriceSane(stopPxTidy)) {
                    logError(`[ExitOrders] ❌ Invalid SL order for ${coin}: qty=${slQty} (minSize=${minSize}), px=${stopPxTidy} (sane=${isPriceSane(stopPxTidy)}). Marking as skipped.`);
                    (updates.sl as ExitOrderStatus) = { price: stopPxTidy, qty: slQty, placed: true };
                } else {
                    const slOrder: OrderRequest = {
                        coin,
                        is_buy: !isLong,
                        sz: slQty, // Use the rounded SL quantity
                        limit_px: stopPxTidy,
                        order_type: {
                            trigger: { triggerPx: stopPxTidy, isMarket: true, tpsl: 'sl' },
                        },
                        reduce_only: true,
                        grouping: 'positionTpsl',
                    };

                    const res = await retryWithBackoff(() => hyperliquid.exchange.placeOrder(slOrder), 3, 1000, 2, `SL @ ${stopPxTidy}`);
                    const statusMessage = res?.response?.data?.statuses?.[0]?.status || JSON.stringify(res?.response?.data?.statuses?.[0]);

                    if (wasOrderAccepted(res)) {
                        logInfo(`[ExitOrders] 🛑 SL @ ${stopPxTidy} qty=${slQty} is ${statusMessage} for ${coin}`);
                        (updates.sl as ExitOrderStatus) = { price: stopPxTidy, qty: slQty, placed: true };
                    } else {
                        logError(`[ExitOrders] ❌ SL @ ${stopPxTidy} failed for ${coin} → ${statusMessage}`);
                        (updates.sl as ExitOrderStatus) = { price: stopPxTidy, qty: slQty, placed: false };
                    }
                }
            }

            // Merge updates into the signal data
            const updatedSignal: ExitOrdersSignal = { ...data, ...updates };

            // Check if all exit orders are placed
            const allDone = ['tp1', 'tp2', 'tp3', 'runner', 'sl'].every(f => (updatedSignal[f as keyof ExitOrdersSignal] as ExitOrderStatus)?.placed);

            if (allDone) {
                await redis.del(key); // Delete key if all orders are placed
                logInfo(`[ExitOrders] ✅ All exit orders placed for ${coin}, key cleared.`);
            } else {
                await redis.set(key, JSON.stringify(updatedSignal)); // Update Redis with pending status
                logWarn(` ⚠️ [ExitOrders] 🔁 Some exit orders pending for ${coin}, will retry.`);
            }

            await updateBotStatus('exits'); // Update bot health status
        } catch (err: any) {
            logError(`[ExitOrders] ❌ Error processing key ${key}: ${err.message || JSON.stringify(err)}`);
            await updateBotErrorStatus('exits', err); // Update bot error status
        }
    }
};

// Schedule the worker to run periodically
setInterval(processPendingExitOrders, 5000); // Run every 5 seconds
