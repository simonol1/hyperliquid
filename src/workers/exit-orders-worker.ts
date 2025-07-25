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
// ADJUSTED: Increased tolerance further for price sanity check to 40%
const PRICE_TOLERANCE_PCT = 40; // 40% tolerance

type ExitOrderKey = 'tp1' | 'tp2' | 'tp3' | 'runner' | 'sl';

const setExitOrder = (
    updates: Partial<Pick<ExitOrdersSignal, ExitOrderKey>>,
    key: ExitOrderKey,
    status: ExitOrderStatus
) => {
    updates[key] = status;
};

// Helper to round price to pxDecimals and ensure it's a number
const getTidyPx = (price: number, pxDecimals: number): number => {
    if (isNaN(price) || !Number.isFinite(price)) {
        logError(`[getTidyPx] Invalid price input: ${price}`);
        return NaN; // Return NaN if input is invalid
    }
    const tickSize = 1 / Math.pow(10, pxDecimals);
    // Perform rounding, but keep it as a number for internal calculations.
    // The final string conversion will happen just before sending to API.
    return Math.round(price / tickSize) * tickSize;
};

// Helper to round quantity to szDecimals and ensure it's a number
const getTidyQty = (qty: number, szDecimals: number): number => {
    if (isNaN(qty) || !Number.isFinite(qty)) {
        logError(`[getTidyQty] Invalid quantity input: ${qty}`);
        return NaN; // Return NaN if input is invalid
    }
    const stepSize = 1 / Math.pow(10, szDecimals);
    // Use Math.floor to ensure we don't exceed available precision and avoid tiny dust orders
    return Number((Math.floor(qty / stepSize) * stepSize).toFixed(szDecimals));
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
    totalQty: number; // Matches executeEntry
    tpPercents: number[];
    runnerPercent: number; // Matches executeEntry
    stopLossPercent: number;
    tp1: ExitOrderStatus;
    tp2: ExitOrderStatus;
    tp3: ExitOrderStatus;
    runner: ExitOrderStatus;
    sl: ExitOrderStatus;
}

const wasOrderAccepted = (status: any): boolean => {
    // Hyperliquid API response status can be a string or an object with a 'status' property
    if (typeof status === 'object' && status !== null && 'status' in status) {
        return ['accepted', 'resting', 'waitingForTrigger'].includes(status.status);
    }
    // Fallback for cases where status is directly a string (less common but defensive)
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

            // Robust data validation immediately after parsing from Redis
            if (isNaN(data.entryPx) || !Number.isFinite(data.entryPx) ||
                isNaN(data.pxDecimals) || !Number.isFinite(data.pxDecimals) ||
                isNaN(data.szDecimals) || !Number.isFinite(data.szDecimals) ||
                isNaN(data.ts) || !Number.isFinite(data.ts) ||
                isNaN(data.totalQty) || !Number.isFinite(data.totalQty) ||
                !Array.isArray(data.tpPercents) || data.tpPercents.some(isNaN) ||
                isNaN(data.runnerPercent) || !Number.isFinite(data.runnerPercent) ||
                isNaN(data.stopLossPercent) || !Number.isFinite(data.stopLossPercent)) {
                logError(`[ExitOrders] ❌ Corrupted or incomplete signal data for ${coin} in Redis. Deleting key. Data: ${raw}`);
                await redis.del(key);
                continue;
            }

            const { isLong, entryPx, pxDecimals, szDecimals, ts, totalQty, tpPercents, runnerPercent, stopLossPercent } = data;

            const meta = metaMap.get(coin);
            if (!meta) {
                logError(`[ExitOrders] ❌ No coin meta found for ${coin}. Skipping.`);
                continue;
            }

            const positionState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
            const openPos = positionState.assetPositions.find(p => p.position.coin === coin && parseFloat(p.position?.szi ?? '0') > 0);
            if (!openPos) {
                // Only delete if the signal is old, otherwise wait for position to open
                if (Date.now() - ts > 60_000) { // 60 seconds expiry
                    logWarn(` ⚠️ [ExitOrders] ❌ Expired: ${coin} TP/SL not placed in 60s (position not found). Deleting key.`);
                    await redis.del(key);
                } else {
                    logDebug(`[ExitOrders] ⏳ Awaiting position open for ${coin}. Signal timestamp: ${new Date(ts).toISOString()}`);
                }
                continue;
            }

            const currentPositionQty = parseFloat(openPos.position.szi);
            if (isNaN(currentPositionQty) || currentPositionQty <= 0) {
                logError(`[ExitOrders] ❌ Invalid current position quantity for ${coin}: ${currentPositionQty}. Skipping.`);
                continue;
            }

            // Re-enabled: Cancel any stale GTC orders for this coin before placing new ones
            await cancelStaleGtc(hyperliquid, coin, subaccountAddress);

            const minSize = meta.minSize;
            // Quantities are 25% of current position, correctly calculated
            const chunkQty = getTidyQty(currentPositionQty * 0.25, szDecimals);
            const runnerQty = getTidyQty(currentPositionQty * 0.25, szDecimals);
            const slQty = getTidyQty(currentPositionQty, szDecimals); // SL covers full current position

            // Fetch current market price for sanity checks
            const book = await hyperliquid.info.getL2Book(coin);
            const [asks, bids] = book.levels;
            const bestAsk = parseFloat(asks[0].px);
            const bestBid = parseFloat(bids[0].px);
            const mid = (bestAsk + bestBid) / 2;

            // Helper function for price validation against current market
            const isPriceSane = (calculatedPx: number): boolean => {
                if (isNaN(calculatedPx) || !Number.isFinite(calculatedPx) || calculatedPx <= 0 || calculatedPx > MAX_PRICE_SANITY) {
                    logDebug(`[ExitOrders] Price sanity check failed for ${coin}: calculatedPx=${calculatedPx} (invalid number or out of absolute range).`);
                    return false;
                }
                if (isNaN(mid) || mid === 0) {
                    logWarn(`[ExitOrders] ⚠️ Current market price for ${coin} is invalid (${mid}). Skipping price sanity check.`);
                    return true; // Cannot perform sanity check, assume sane for now
                }
                const deviation = Math.abs((calculatedPx - mid) / mid) * 100;
                logDebug(`[ExitOrders] Price sanity check for ${coin}: calculatedPx=${calculatedPx.toFixed(pxDecimals)}, mid=${mid.toFixed(pxDecimals)}, deviation=${deviation.toFixed(2)}% (tolerance=${PRICE_TOLERANCE_PCT}%)`); // NEW: Detailed debug log
                return deviation <= PRICE_TOLERANCE_PCT;
            };

            // Helper function to place individual exit orders
            const placeExitOrder = async (
                label: string,
                px: number, // px is the numerically tidied price
                qty: number,
                tpsl: 'tp' | 'sl'
            ): Promise<{ status: string; placed: boolean }> => {
                // Ensure px is valid before passing to OrderRequest
                if (isNaN(px) || !Number.isFinite(px) || px <= 0) {
                    logError(`[ExitOrders] ❌ ${label} @ ${px} has invalid price calculation. Skipping order.`);
                    return { status: 'Invalid Price Calculation', placed: false };
                }
                // Ensure qty is valid before passing to OrderRequest
                if (isNaN(qty) || !Number.isFinite(qty) || qty <= 0) {
                    logError(`[ExitOrders] ❌ ${label} @ ${px} has invalid quantity calculation (${qty}). Skipping order.`);
                    return { status: 'Invalid Quantity Calculation', placed: false };
                }

                const order: OrderRequest = {
                    coin,
                    is_buy: !isLong,
                    sz: qty,
                    // FIX: Pass limit_px as a string formatted to pxDecimals
                    limit_px: px.toFixed(pxDecimals),
                    order_type: {
                        trigger: {
                            // FIX: Pass triggerPx as a string formatted to pxDecimals
                            triggerPx: px.toFixed(pxDecimals),
                            isMarket: true,
                            tpsl
                        },
                    },
                    reduce_only: true,
                    grouping: 'positionTpsl',
                };

                // Increased initialDelayMs for retryWithBackoff to combat rate limits
                const res = await retryWithBackoff(
                    () => hyperliquid.exchange.placeOrder(order),
                    3, // retries
                    2000, // initialDelayMs (increased from 1000)
                    2, // multiplier
                    `${label} @ ${px.toFixed(pxDecimals)}` // Label for logging, use formatted price
                );

                const statusObj = res?.response?.data?.statuses?.[0];
                const statusMessage = statusObj?.status || JSON.stringify(statusObj);

                if (wasOrderAccepted(statusObj)) { // Check statusObj directly
                    logInfo(`[ExitOrders] ✅ ${label} @ ${px.toFixed(pxDecimals)} qty=${qty} is ${statusMessage} for ${coin}`);
                    return { status: statusMessage, placed: true };
                } else {
                    logError(`[ExitOrders] ❌ ${label} @ ${px.toFixed(pxDecimals)} failed for ${coin} → ${statusMessage}`);
                    return { status: statusMessage, placed: false };
                }
            };

            const updates: Partial<Pick<ExitOrdersSignal, ExitOrderKey>> = {};

            // --- Place Take Profit Orders (TP1, TP2, TP3) ---
            for (let i = 0; i < tpPercents.length; i++) {
                const pct = tpPercents[i];
                const rawPx = isLong ? entryPx * (1 + pct / 100) : entryPx * (1 - pct / 100);
                const px = getTidyPx(rawPx, pxDecimals); // Ensure px is tidied and a number
                const field = `tp${i + 1}` as ExitOrderKey;

                if ((data[field] as ExitOrderStatus)?.placed) continue;

                // Separate checks for clearer logging and to ensure `px` and `chunkQty` are valid numbers
                if (isNaN(chunkQty) || chunkQty < minSize || !Number.isFinite(chunkQty)) {
                    logError(`[ExitOrders] ❌ Invalid TP${i + 1} order for ${coin}: qty=${chunkQty} (below minSize=${minSize}). Marking as skipped.`);
                    setExitOrder(updates, field, { price: px, qty: chunkQty, placed: true });
                    continue;
                }
                if (isNaN(px) || !isPriceSane(px)) {
                    logError(`[ExitOrders] ❌ Invalid TP${i + 1} order for ${coin}: px=${px.toFixed(pxDecimals)} (not sane or invalid number, deviation > ${PRICE_TOLERANCE_PCT}% from market). Marking as skipped.`);
                    setExitOrder(updates, field, { price: px, qty: chunkQty, placed: true });
                    continue;
                }

                const result = await placeExitOrder(`TP${i + 1}`, px, chunkQty, 'tp');
                setExitOrder(updates, field, { price: px, qty: chunkQty, placed: result.placed }); // Use result.placed
            }

            // --- Place Runner Take Profit Order ---
            if (!data.runner?.placed) {
                // Use runnerPercent from data for price calculation
                const rawPx = isLong ? entryPx * (1 + runnerPercent / 100) : entryPx * (1 - runnerPercent / 100);
                const px = getTidyPx(rawPx, pxDecimals); // Ensure px is tidied and a number

                if (isNaN(runnerQty) || runnerQty < minSize || !Number.isFinite(runnerQty)) {
                    logError(`[ExitOrders] ❌ Invalid Runner TP for ${coin}: qty=${runnerQty} (below minSize=${minSize}). Marking as skipped.`);
                    updates.runner = { price: px, qty: runnerQty, placed: true };
                } else if (isNaN(px) || !isPriceSane(px)) {
                    logError(`[ExitOrders] ❌ Invalid Runner TP for ${coin}: px=${px.toFixed(pxDecimals)} (not sane or invalid number, deviation > ${PRICE_TOLERANCE_PCT}% from market). Marking as skipped.`);
                    updates.runner = { price: px, qty: runnerQty, placed: true };
                } else {
                    const result = await placeExitOrder('Runner TP', px, runnerQty, 'tp');
                    updates.runner = { price: px, qty: runnerQty, placed: result.placed }; // Use result.placed
                }
            }

            // --- Place Stop Loss Order ---
            if (!data.sl?.placed) {
                const rawPx = isLong ? entryPx * (1 - stopLossPercent / 100) : entryPx * (1 + stopLossPercent / 100);
                const px = getTidyPx(rawPx, pxDecimals); // Ensure px is tidied and a number

                if (isNaN(slQty) || slQty < minSize || !Number.isFinite(slQty)) {
                    logError(`[ExitOrders] ❌ Invalid SL for ${coin}: qty=${slQty} (below minSize=${minSize}). Marking as skipped.`);
                    updates.sl = { price: px, qty: slQty, placed: true };
                } else if (isNaN(px) || !isPriceSane(px)) {
                    logError(`[ExitOrders] ❌ Invalid SL for ${coin}: px=${px.toFixed(pxDecimals)} (not sane or invalid number, deviation > ${PRICE_TOLERANCE_PCT}% from market). Marking as skipped.`);
                    updates.sl = { price: px, qty: slQty, placed: true };
                } else {
                    const result = await placeExitOrder('SL', px, slQty, 'sl');
                    updates.sl = { price: px, qty: slQty, placed: result.placed }; // Use result.placed
                }
            }

            const updatedSignal: ExitOrdersSignal = { ...data, ...updates };
            const allPlaced = (['tp1', 'tp2', 'tp3', 'runner', 'sl'] as ExitOrderKey[]).every(
                k => updatedSignal[k]?.placed
            );

            if (allPlaced) {
                await redis.del(key);
                logInfo(`[ExitOrders] ✅ All exit orders placed for ${coin}, key cleared.`);
            } else {
                await redis.set(key, JSON.stringify(updatedSignal));
                logWarn(` ⚠️ [ExitOrders] 🔁 Some exit orders still pending for ${coin}`);
            }

            await updateBotStatus('exits');
        } catch (err: any) {
            logError(`[ExitOrders] ❌ Error processing ${key}: ${err.message || JSON.stringify(err)}`);
            await updateBotErrorStatus('exits', err);
        }
    }
};

setInterval(processPendingExitOrders, 5000);
