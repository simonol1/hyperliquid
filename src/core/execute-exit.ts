import { logInfo, logError, logExit, logWarn, logDebug } from '../shared-utils/logger.js'; // Added logDebug
import { stateManager } from '../shared-utils/state-manager.js';
import { placeOrderSafe } from '../orders/place-order-safe.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { CoinMeta } from '../shared-utils/coin-meta.js';
import { checkRiskGuards } from '../shared-utils/risk-guards.js';
import { getTrackedPosition, updateTrackedPosition } from '../shared-utils/tracked-position.js';
import { redis } from '../shared-utils/redis-client.js';
import { TradeTracker } from '../shared-utils/trade-tracker.js'; // NEW: Import TradeTracker

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
        // If no tracked position, there's no trade ID to mark as failed in TradeTracker
        return;
    }

    // Retrieve the trade ID from the tracked position
    const tradeId = tracked.tradeId; // Assuming `tracked` now contains `tradeId`

    if (!tradeId) {
        logError(`[ExecuteExit] ❌ No trade ID found in tracked position for ${coin}. Cannot mark closed in TradeTracker.`);
        // Proceed with closing the position on exchange, but TradeTracker won't be updated.
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
        // NEW: Mark as closed in TradeTracker if position is already flat
        if (tradeId) {
            try {
                // Use the last known entry price as exit if position is already flat and no explicit exit price
                const finalPnl = (exitIntent.price - tracked.entryPrice) * tracked.qty * (tracked.isLong ? 1 : -1);
                await TradeTracker.markClosed(tradeId, exitIntent.price, finalPnl);
                logDebug(`[ExecuteExit] Trade ${tradeId} marked as closed (already flat).`);
            } catch (err: any) {
                logError(`[ExecuteExit] ❌ Failed to mark trade ${tradeId} as closed (already flat) in TradeTracker: ${err.message || JSON.stringify(err)}`);
            }
        }
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
        // NEW: Mark trade as failed in TradeTracker if exit is blocked
        if (tradeId) {
            await TradeTracker.markFailed(tradeId);
            logDebug(`[ExecuteExit] Trade ${tradeId} marked as failed (exit blocked by risk guards).`);
        }
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
        // NEW: Mark as closed in TradeTracker if quantity is zero
        if (tradeId) {
            try {
                // Use the last known entry price as exit if quantity is zero and no explicit exit price
                const finalPnl = (exitIntent.price - tracked.entryPrice) * tracked.qty * (tracked.isLong ? 1 : -1);
                await TradeTracker.markClosed(tradeId, exitIntent.price, finalPnl);
                logDebug(`[ExecuteExit] Trade ${tradeId} marked as closed (zero quantity).`);
            } catch (err: any) {
                logError(`[ExecuteExit] ❌ Failed to mark trade ${tradeId} as closed (zero quantity) in TradeTracker: ${err.message || JSON.stringify(err)}`);
            }
        }
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
        // NEW: Mark trade as failed in TradeTracker if exit order placement fails
        if (tradeId) {
            await TradeTracker.markFailed(tradeId);
            logDebug(`[ExecuteExit] Trade ${tradeId} marked as failed (exit order placement failure).`);
        }
        return;
    }

    // If a GTC fallback was used, it's tracked in Redis by placeOrderSafe, so we just log here.
    if (result.tif === 'Gtc') {
        logInfo(`[ExecuteExit] ⏳ GTC fallback exit was used and tracked for ${coin}.`);
        // The GTC order will be handled by the exit-orders-worker or manual intervention.
        // We don't mark the tracked position as fully closed yet, as the GTC might not fill immediately.
        // NEW: If GTC fallback, we don't mark as closed yet. TradeTracker remains 'confirmed'.
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
        // NEW: Mark as failed in TradeTracker if PnL calculation fails
        if (tradeId) {
            await TradeTracker.markFailed(tradeId);
            logDebug(`[ExecuteExit] Trade ${tradeId} marked as failed (PnL calculation issue).`);
        }
        return;
    }

    logExit({ asset: coin, price: tidyPx, reason: exitIntent.reason });

    // Calculate PnL based on the actual exit price (tidyPx) and entry price
    const pnl = (tidyPx - entryPx) * tidyQty * (isShort ? -1 : 1);
    pnl < 0 ? stateManager.addLoss(Math.abs(pnl)) : stateManager.addProfit(pnl);

    logInfo(`[ExecuteExit] ✅ Closed ${coin} | PnL ${pnl.toFixed(2)} USD (Reason: ${exitIntent.reason})`);

    // NEW: Mark trade as closed in TradeTracker after successful full closure and PnL calculation
    if (tradeId) {
        try {
            await TradeTracker.markClosed(tradeId, tidyPx, pnl);
            logDebug(`[ExecuteExit] Trade ${tradeId} marked as closed in TradeTracker.`);
        } catch (err: any) {
            logError(`[ExecuteExit] ❌ Failed to mark trade ${tradeId} as closed in TradeTracker: ${err.message || JSON.stringify(err)}`);
        }
    }

    // Clear tracked position and pending exit orders after a successful full closure
    await redis.del(`trackedPosition:${coin}`);
    await redis.del(`pendingExitOrders:${coin}`); // Ensure pending exit orders are cleared
};
