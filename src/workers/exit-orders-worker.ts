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

const getTidyPx = (price: number, pxDecimals: number): number => {
    const tickSize = 1 / Math.pow(10, pxDecimals);
    return Math.round(price / tickSize) * tickSize;
};

const getTidyQty = (qty: number, szDecimals: number): number => {
    const stepSize = 1 / Math.pow(10, szDecimals);
    return Math.floor(qty / stepSize) * stepSize;
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
            if (!raw) continue;

            const data: ExitOrdersSignal = JSON.parse(raw);
            const { isLong, entryPx, pxDecimals, szDecimals, ts, tpPercents, runnerPercent, stopLossPercent } = data;

            const meta = metaMap.get(coin);
            const minSize = meta?.minSize ?? 0;

            const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
            const openPosition = perpState.assetPositions.find(p => p.position.coin === coin && parseFloat(p.position?.szi ?? '0') > 0);
            if (!openPosition) {
                if (Date.now() - ts > 90_000) {
                    logWarn(`[ExitOrders] ❌ Expired: ${coin} TP/SL not placed in 60s. Deleting key.`);
                    await redis.del(key);
                } else {
                    logDebug(`[ExitOrders] ⏳ Awaiting open position for ${coin}.`);
                }
                continue;
            }

            const currentQty = getTidyQty(parseFloat(openPosition.position.szi), szDecimals);
            const chunkQty = getTidyQty(currentQty * 0.25, szDecimals);
            const runnerQty = getTidyQty(currentQty * 0.25, szDecimals);

            const book = await hyperliquid.info.getL2Book(coin);
            const [asks, bids] = book.levels;
            const bestAsk = parseFloat(asks[0].px);
            const bestBid = parseFloat(bids[0].px);
            const midPx = (bestAsk + bestBid) / 2;

            const isPriceSane = (px: number): boolean => {
                if (px <= 0 || px > MAX_PRICE_SANITY) return false;
                if (isNaN(midPx) || midPx === 0) return true;
                const deviation = Math.abs((px - midPx) / midPx) * 100;
                return deviation <= PRICE_TOLERANCE_PCT;
            };

            const updates: Partial<ExitOrdersSignal> = {};

            const placeExitOrder = async (
                label: string,
                targetPx: number,
                qty: number,
                tpsl: 'tp' | 'sl',
                field: keyof ExitOrdersSignal
            ) => {
                const tidyPx = getTidyPx(targetPx, pxDecimals);
                const order: OrderRequest = {
                    coin,
                    is_buy: !isLong,
                    sz: qty,
                    limit_px: tidyPx.toFixed(pxDecimals),
                    order_type: {
                        trigger: { triggerPx: tidyPx.toFixed(pxDecimals), isMarket: true, tpsl },
                    },
                    reduce_only: true,
                    grouping: 'positionTpsl',
                };

                if (qty < minSize || !isPriceSane(tidyPx)) {
                    logError(`[ExitOrders] ❌ Invalid ${label} for ${coin}: qty=${qty}, px=${tidyPx}`);
                    (updates[field] as ExitOrderStatus) = { price: tidyPx, qty, placed: true };
                    return;
                }

                logDebug(`[ExitOrders] ${coin} ${label} qty=${qty} px=${tidyPx}`);

                const res = await retryWithBackoff(() => hyperliquid.exchange.placeOrder(order), 3, 1000, 2, `${label} @ ${tidyPx}`);
                const status = res?.response?.data?.statuses?.[0];

                if (wasOrderAccepted(status)) {
                    logInfo(`[ExitOrders] ✅ ${label} @ ${tidyPx} accepted for ${coin} → ${status}`);
                    (updates[field] as ExitOrderStatus) = { price: tidyPx, qty, placed: true };
                } else {
                    logError(`[ExitOrders] ❌ ${label} @ ${tidyPx} failed for ${coin} → ${JSON.stringify(status)}`);
                    (updates[field] as ExitOrderStatus) = { price: tidyPx, qty, placed: false };
                }
            };

            for (let i = 0; i < tpPercents.length; i++) {
                const label = `TP${i + 1}`;
                const pct = tpPercents[i];
                const px = isLong ? entryPx * (1 + pct / 100) : entryPx * (1 - pct / 100);
                const field = `tp${i + 1}` as keyof ExitOrdersSignal;

                if (!(data[field] as ExitOrderStatus)?.placed) {
                    await placeExitOrder(label, px, chunkQty, 'tp', field);
                }
            }

            if (!(data.runner as ExitOrderStatus)?.placed) {
                const px = isLong ? entryPx * (1 + runnerPercent / 100) : entryPx * (1 - runnerPercent / 100);
                await placeExitOrder('Runner TP', px, runnerQty, 'tp', 'runner');
            }

            if (!(data.sl as ExitOrderStatus)?.placed) {
                const px = isLong ? entryPx * (1 - stopLossPercent / 100) : entryPx * (1 + stopLossPercent / 100);
                await placeExitOrder('SL', px, currentQty, 'sl', 'sl');
            }

            const updated: ExitOrdersSignal = { ...data, ...updates };
            const allDone = ['tp1', 'tp2', 'tp3', 'runner', 'sl'].every(f =>
                (updated[f as keyof ExitOrdersSignal] as ExitOrderStatus)?.placed
            );

            if (allDone) {
                await redis.del(key);
                logInfo(`[ExitOrders] ✅ All exit orders placed for ${coin}, key cleared.`);
            } else {
                await redis.set(key, JSON.stringify(updated));
                logWarn(`[ExitOrders] 🔁 Some exit orders still pending for ${coin}`);
            }

            await updateBotStatus('exits');
        } catch (err: any) {
            logError(`[ExitOrders] ❌ Error processing ${key}: ${err.message || JSON.stringify(err)}`);
            await updateBotErrorStatus('exits', err);
        }
    }
};

setInterval(processPendingExitOrders, 5000);
