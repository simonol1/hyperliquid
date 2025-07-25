import { logInfo, logError, logExit, logWarn } from '../shared-utils/logger.js';
import { stateManager } from '../shared-utils/state-manager.js';
import { placeOrderSafe } from '../orders/place-order-safe.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { CoinMeta } from '../shared-utils/coin-meta.js';
import { checkRiskGuards } from '../shared-utils/risk-guards.js';
import { getTrackedPosition, updateTrackedPosition } from '../shared-utils/tracked-position.js';
import { redis } from '../shared-utils/redis-client.js';

export interface ExitIntent {
    quantity: number; // This quantity should represent the full amount to close
    price: number;
    type: 'SELL' | 'CLOSE' | 'EXIT'; // 'SELL' or 'BUY' based on position side, 'CLOSE' for general exit
    reason: string;
}

export const executeExit = async (
    hyperliquid: Hyperliquid,
    subaccountAddress: string,
    exitIntent: ExitIntent,
    coinMeta?: CoinMeta
) => {
    if (!coinMeta) {
        logError(`[ExecuteExit] ❌ No coin meta provided for exit.`);
        return;
    }

    const { coin, pxDecimals, szDecimals } = coinMeta;
    logInfo(`[ExecuteExit] Starting exit for ${coin} → Reason: ${exitIntent.reason}`);

    const tracked = await getTrackedPosition(coin);
    if (!tracked) {
        logError(`[ExecuteExit] ❌ No tracked position found for ${coin}. Cannot execute exit.`);
        return;
    }

    const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
    const realPosition = perpState.assetPositions.find(
        (p) => p.position.coin === coin && Math.abs(parseFloat(p.position.szi)) > 0
    );

    if (!realPosition) {
        logInfo(`[ExecuteExit] ✅ Position for ${coin} already flat. No exit needed.`);
        // If the position is already flat, ensure the tracked position is also cleared
        await redis.del(`trackedPosition:${coin}`);
        await redis.del(`pendingExitOrders:${coin}`); // Clear pending exit orders if position is gone
        return;
    }

    const entryPx = parseFloat(realPosition.position.entryPx);
    const szi = parseFloat(realPosition.position.szi);
    const isShort = szi < 0;
    const rawQty = Math.abs(szi); // This is the full current quantity of the position

    // Always attempt to close the full remaining position when executeExit is called.
    // The decision to call executeExit (e.g., trailing stop hit, final TP hit)
    // should be made upstream in evaluateExit.
    const qtyToClose = rawQty;

    const { canTrade, qty: safeQty } = await checkRiskGuards(
        hyperliquid,
        subaccountAddress,
        qtyToClose, // Use the full quantity to close
        exitIntent.price,
        coinMeta
    );

    if (!canTrade) {
        logWarn(`[ExecuteExit] ⚠️ Exit for ${coin} blocked by risk guards. Reason: ${exitIntent.reason}`);
        return;
    }

    const tidyQty = Number(safeQty.toFixed(szDecimals));
    const exitSideIsBuy = isShort; // If short, we buy to close; if long, we sell to close

    // Ensure we don't try to close a zero or negative quantity
    if (tidyQty <= 0) {
        logWarn(`[ExecuteExit] ⚠️ Calculated quantity to close for ${coin} is zero or negative (${tidyQty}). Skipping exit.`);
        // If quantity is zero, assume position is effectively closed and clear state
        await redis.del(`trackedPosition:${coin}`);
        await redis.del(`pendingExitOrders:${coin}`);
        return;
    }

    logInfo(`[ExecuteExit] Attempting to place market exit order for ${coin}: ${exitSideIsBuy ? 'BUY' : 'SELL'} ${tidyQty} @ ${exitIntent.price.toFixed(pxDecimals)} (Reason: ${exitIntent.reason})`);

    const result = await placeOrderSafe(
        hyperliquid,
        coin,
        exitSideIsBuy,
        tidyQty,
        true, // reduce_only: true
        'Ioc', // Use IOC for immediate market exit
        subaccountAddress,
        pxDecimals
    );

    if (!result.success) {
        logError(`[ExecuteExit] ❌ Failed to place exit order for ${coin}. Reason: ${exitIntent.reason}`);
        // Do not return here if result.tif was Gtc and it was tracked.
        // The GTC fallback logic should handle its own tracking.
        return;
    }

    // If a GTC fallback was used, it's tracked in Redis by placeOrderSafe, so we just log here.
    if (result.tif === 'Gtc') {
        logInfo(`[ExecuteExit] ⏳ GTC fallback exit was used and tracked for ${coin}.`);
        // The GTC order will be handled by the exit-orders-worker or manual intervention.
        // We don't mark the tracked position as fully closed yet, as the GTC might not fill immediately.
        return;
    }

    // If the IOC order was successful (filled or resting), proceed with PnL calculation and state update
    const book = await hyperliquid.info.getL2Book(coin);
    const [asks, bids] = book.levels;
    // Use the side-appropriate market price for PnL calculation
    const marketPx = isShort ? parseFloat(asks[0]?.px || '0') : parseFloat(bids[0]?.px || '0');
    const tidyPx = Number(marketPx.toFixed(pxDecimals));

    // Ensure marketPx is valid before PnL calculation
    if (isNaN(marketPx) || marketPx === 0) {
        logError(`[ExecuteExit] ❌ Cannot calculate PnL for ${coin}: Invalid market price (${marketPx}).`);
        // Still clear tracked position as the exit order was placed successfully
        await redis.del(`trackedPosition:${coin}`);
        await redis.del(`pendingExitOrders:${coin}`);
        return;
    }

    logExit({ asset: coin, price: tidyPx, reason: exitIntent.reason });

    // Calculate PnL based on the actual exit price (tidyPx) and entry price
    const pnl = (tidyPx - entryPx) * tidyQty * (isShort ? -1 : 1);
    pnl < 0 ? stateManager.addLoss(Math.abs(pnl)) : stateManager.addProfit(pnl);

    logInfo(`[ExecuteExit] ✅ Closed ${coin} | PnL ${pnl.toFixed(2)} USD (Reason: ${exitIntent.reason})`);

    // Clear tracked position and pending exit orders after a successful full closure
    await redis.del(`trackedPosition:${coin}`);
    await redis.del(`pendingExitOrders:${coin}`); // Ensure pending exit orders are cleared


};
