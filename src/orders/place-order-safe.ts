// ✅ Place Order with IOC Priority, Clean Logging + Status Checks
import { logInfo, logDebug, logError, logWarn } from '../shared-utils/logger.js';
import type { Hyperliquid } from '../sdk/index.js';

interface PlaceOrderResult {
    success: boolean;
    px?: number;
    tif?: 'Ioc' | 'Gtc';
}

export const placeOrderSafe = async (
    hyperliquid: Hyperliquid,
    coin: string,
    isBuy: boolean,
    qty: number,
    reduceOnly: boolean,
    tif: 'Ioc' | 'Gtc',
    subaccountAddress: string,
    pxDecimals: number
): Promise<PlaceOrderResult> => {
    const tickSize = 1 / Math.pow(10, pxDecimals);

    const book = await hyperliquid.info.getL2Book(coin);
    const [asks, bids] = book.levels;
    const bestAsk = parseFloat(asks[0].px);
    const bestBid = parseFloat(bids[0].px);

    let px = isBuy ? bestAsk * 1.0001 : bestBid * 0.9999;
    px = Math.round(px / tickSize) * tickSize;

    logDebug(`[PlaceOrderSafe] ${coin} ${isBuy ? 'BUY' : 'SELL'} qty=${qty} px=${px} (${tif})`);

    const res = await hyperliquid.exchange.placeOrder({
        coin,
        is_buy: isBuy,
        sz: qty,
        limit_px: px.toFixed(pxDecimals),
        order_type: { limit: { tif } },
        reduce_only: reduceOnly,
        vaultAddress: subaccountAddress,
    });

    const status = res?.response?.data?.statuses?.[0];

    if (res.status === 'ok') {
        const filled = parseFloat(status?.filled?.totalSz ?? '0');
        const resting = status?.resting;

        if (filled || resting) {
            logInfo(`[PlaceOrderSafe] ✅ IOC ${filled ? 'filled' : 'resting'} @ ${px}`);
            return { success: true, px, tif };
        }
    }

    logDebug(`[PlaceOrderSafe] ${tif} not filled → retrying`);

    const retryBook = await hyperliquid.info.getL2Book(coin);
    const [retryAsks, retryBids] = retryBook.levels;
    let retryPx = isBuy ? parseFloat(retryAsks[0].px) * 1.0002 : parseFloat(retryBids[0].px) * 0.9998;
    retryPx = Math.round(retryPx / tickSize) * tickSize;

    logDebug(`[PlaceOrderSafe] Retry px=${retryPx}`);

    const retryRes = await hyperliquid.exchange.placeOrder({
        coin,
        is_buy: isBuy,
        sz: qty,
        limit_px: retryPx.toFixed(pxDecimals),
        order_type: { limit: { tif } },
        reduce_only: reduceOnly,
        vaultAddress: subaccountAddress,
    });

    const retryStatus = retryRes?.response?.data?.statuses?.[0];

    if (retryRes.status === 'ok') {
        const filled = parseFloat(retryStatus?.filled?.totalSz ?? '0');
        const resting = retryStatus?.resting;

        if (filled || resting) {
            logInfo(`[PlaceOrderSafe] ✅ Retry IOC ${filled ? 'filled' : 'resting'} @ ${retryPx}`);
            return { success: true, px: retryPx, tif };
        }
    }

    logDebug(`[PlaceOrderSafe] Retry ${tif} failed → fallback GTC`);

    try {
        const fallbackPx = isBuy ? parseFloat(retryAsks[0].px) : parseFloat(retryBids[0].px);
        const fallbackPxTidy = Math.round(fallbackPx / tickSize) * tickSize;

        const fallbackRes = await hyperliquid.exchange.placeOrder({
            coin,
            is_buy: isBuy,
            sz: qty,
            limit_px: fallbackPxTidy.toFixed(pxDecimals),
            order_type: { limit: { tif: 'Gtc' } },
            reduce_only: reduceOnly,
            vaultAddress: subaccountAddress,
        });

        const fallbackStatus = fallbackRes?.response?.data?.statuses?.[0];

        if (fallbackRes.status === 'ok') {
            const filled = fallbackStatus?.filled?.totalSz;
            const resting = fallbackStatus?.resting;

            if (filled || resting) {
                logInfo(`[PlaceOrderSafe] ✅ Fallback GTC ${filled ? 'filled' : 'resting'} @ ${fallbackPxTidy}`);
                return { success: true, px: fallbackPxTidy, tif: 'Gtc' };
            } else {
                logWarn(`[PlaceOrderSafe] ⚠️ Fallback GTC returned unrecognized status → ${JSON.stringify(fallbackStatus)}`);
            }
        } else {
            logError(`[PlaceOrderSafe] ❌ Fallback GTC failed → ${JSON.stringify(fallbackRes)}`);
        }

    } catch (e: any) {
        logError(`[PlaceOrderSafe] ❌ Fallback GTC exception → ${JSON.stringify(e.response?.data || e.message || e)}`);
    }

    return { success: false };
};
