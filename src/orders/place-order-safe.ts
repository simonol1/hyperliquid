import { logInfo, logDebug, logError } from '../shared-utils/logger.js';
import type { Hyperliquid } from '../sdk/index.js';

export const placeOrderSafe = async (
    hyperliquid: Hyperliquid,
    coin: string,
    isBuy: boolean,
    qty: number,
    reduceOnly: boolean,
    tif: 'Ioc' | 'Gtc',
    subaccountAddress: string,
    pxDecimals: number
) => {
    const tickSize = 1 / Math.pow(10, pxDecimals);

    const book = await hyperliquid.info.getL2Book(coin);
    const [asks, bids] = book.levels;

    const bestAsk = parseFloat(asks[0].px);
    const bestBid = parseFloat(bids[0].px);

    let px = isBuy ? bestAsk * 1.0001 : bestBid * 0.9999;
    px = Math.round(px / tickSize) * tickSize;

    logDebug(`[PlaceOrderSafe] ${coin} ${isBuy ? 'BUY' : 'SELL'} qty=${qty} px=${px} (IOC)`);

    const res = await hyperliquid.exchange.placeOrder({
        coin,
        is_buy: isBuy,
        sz: qty,
        limit_px: px.toFixed(pxDecimals),
        order_type: { limit: { tif: 'Ioc' } },
        reduce_only: reduceOnly,
        vaultAddress: subaccountAddress,
    });

    const status = res.response?.data?.statuses?.[0];
    const filled = parseFloat(status?.filled ?? '0');

    if (res.status === 'ok' && status?.status !== 'error' && filled > 0) {
        logInfo(`[PlaceOrderSafe] ✅ IOC filled @ ${px}`);
        return true;
    }

    logDebug(`[PlaceOrderSafe] IOC not filled → retrying...`);

    // retry once
    const newBook = await hyperliquid.info.getL2Book(coin);
    const [newAsks, newBids] = newBook.levels;
    let retryPx = isBuy ? parseFloat(newAsks[0].px) * 1.0002 : parseFloat(newBids[0].px) * 0.9998;
    retryPx = Math.round(retryPx / tickSize) * tickSize;

    logDebug(`[PlaceOrderSafe] Retry px ${retryPx}`);

    const retryRes = await hyperliquid.exchange.placeOrder({
        coin,
        is_buy: isBuy,
        sz: qty,
        limit_px: retryPx.toFixed(pxDecimals),
        order_type: { limit: { tif: 'Ioc' } },
        reduce_only: reduceOnly,
        vaultAddress: subaccountAddress,
    });

    const retryStatus = retryRes.response?.data?.statuses?.[0];
    const retryFilled = parseFloat(retryStatus?.filled ?? '0');

    if (retryRes.status === 'ok' && retryStatus?.status !== 'error' && retryFilled > 0) {
        logInfo(`[PlaceOrderSafe] ✅ Retry filled @ ${retryPx}`);
        return true;
    }

    logDebug(`[PlaceOrderSafe] Retry failed → fallback GTC`);

    const fallbackPx = isBuy ? parseFloat(newAsks[0].px) : parseFloat(newBids[0].px);
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

    const fallbackAccepted = fallbackRes.status === 'ok';

    if (fallbackAccepted) {
        logInfo(`[PlaceOrderSafe] 🟢 GTC placed @ ${fallbackPxTidy}`);
        return true;
    }

    logError(`[PlaceOrderSafe] ❌ Fallback GTC failed`);
    return false;
};
