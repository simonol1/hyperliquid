import { logInfo, logWarn, logDebug, logError } from '../shared-utils/logger.js';
import { placeOrderSafe } from '../orders/place-order-safe.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { TradeSignal } from '../shared-utils/types.js';
import type { CoinMeta } from '../shared-utils/coin-meta.js';
import type { BotConfig } from '../bots/config/bot-config.js';
import type { PositionSizingResult } from '../shared-utils/position-size.js';
import { checkRiskGuards } from '../shared-utils/risk-guards.js';
import { setTrackedPosition } from '../shared-utils/tracked-position.js';
import { redis } from '../shared-utils/redis-client.js';
import { TradeTracker } from '../shared-utils/trade-tracker.js';

export const executeEntry = async (
    hyperliquid: Hyperliquid,
    signal: TradeSignal,
    config: BotConfig,
    coinMeta: CoinMeta,
    risk: PositionSizingResult,
) => {
    const { coin, pxDecimals, szDecimals, minSize } = coinMeta;
    const rawQty = (risk.capitalRiskUsd * risk.leverage) / signal.entryPrice;

    if (rawQty < minSize) {
        logWarn(`[ExecuteEntry] ⚠️ Initial calculated quantity (${rawQty.toFixed(szDecimals)}) for ${coin} is below minSize (${minSize}). Skipping entry.`);
        return;
    }

    const isLong = signal.side === 'LONG';

    // Push signal to TradeTracker at the very beginning of trade execution
    let tradeRecordId: string | undefined;
    try {
        const newTradeRecord = await TradeTracker.pushSignal({
            bot: config.strategy, // Use the strategy name as the bot identifier
            coin: signal.coin,
            side: signal.side as 'LONG' | 'SHORT',
            entryPrice: signal.entryPrice,
            strength: signal.strength,
            vault: config.subaccountAddress,
            rawSignal: signal // Store the full signal for debugging/analysis
        });
        tradeRecordId = newTradeRecord.id;
        logDebug(`[ExecuteEntry] Trade signal pushed to TradeTracker with ID: ${tradeRecordId}`);
    } catch (err: any) {
        logError(`[ExecuteEntry] ❌ Failed to push trade signal to TradeTracker for ${coin}: ${err.message || JSON.stringify(err)}`);
        // Decide if you want to abort the trade if TradeTracker fails. For now, we continue.
    }


    const { canTrade, qty: safeQty } = await checkRiskGuards(
        hyperliquid,
        config.subaccountAddress,
        rawQty,
        signal.entryPrice,
        coinMeta
    );

    if (!canTrade) {
        logInfo(`[ExecuteEntry] Entry for ${coin} blocked by risk guards.`);
        // Mark trade as failed if it's blocked by risk guards
        if (tradeRecordId) {
            await TradeTracker.markFailed(tradeRecordId);
            logDebug(`[ExecuteEntry] Trade ${tradeRecordId} marked as failed due to risk guards.`);
        }
        return;
    }

    const tidyQty = Number(safeQty.toFixed(szDecimals));

    try {
        await hyperliquid.exchange.updateLeverage(
            coin,
            'isolated',
            risk.leverage
        );
        logDebug(`[ExecuteEntry] Updated leverage to ${risk.leverage}x for ${coin}.`);
    } catch (err: any) {
        logError(`[ExecuteEntry] ❌ Failed to update leverage for ${coin}: ${err.message || JSON.stringify(err)}`);
        // NEW: Mark trade as failed if leverage update fails
        if (tradeRecordId) {
            await TradeTracker.markFailed(tradeRecordId);
            logDebug(`[ExecuteEntry] Trade ${tradeRecordId} marked as failed due to leverage update failure.`);
        }
        return; // Exit if leverage update fails
    }


    const { success, px, tif } = await placeOrderSafe(
        hyperliquid,
        coin,
        isLong,
        tidyQty,
        false, // not reduceOnly for entry
        'Ioc', // Attempt IOC first
        config.subaccountAddress,
        pxDecimals
    );

    if (!success) {
        logError(`[ExecuteEntry] ❌ Failed to place entry order for ${coin}.`);
        // NEW: Mark trade as failed if order placement fails
        if (tradeRecordId) {
            await TradeTracker.markFailed(tradeRecordId);
            logDebug(`[ExecuteEntry] Trade ${tradeRecordId} marked as failed due to order placement failure.`);
        }
        return;
    }

    // If the order was placed as GTC and is resting, it means it's not immediately filled.
    // The exit-orders-worker should still queue TP/SL, but the position might not be
    // immediately visible on the exchange.
    if (tif === 'Gtc') {
        logInfo(`[ExecuteEntry] ⏳ Entry order for ${coin} placed as GTC and is resting. Waiting for fill.`);
    } else {
        logInfo(`[ExecuteEntry] ✅ Entry order for ${coin} placed successfully.`);
    }

    const { entryPrice } = signal;

    const tpPercents = config.takeProfitPercents || [2, 4, 6];
    const runnerPercent = config.runnerPct;
    const stopLossPercent = config.stopLossPct;

    if (tradeRecordId) {
        try {
            await TradeTracker.markConfirmed(tradeRecordId, tidyQty, risk.leverage, {
                takeProfitTarget: isLong
                    ? entryPrice * (1 + tpPercents[tpPercents.length - 1] / 100)
                    : entryPrice * (1 - tpPercents[tpPercents.length - 1] / 100),
                trailingStopTarget: isLong
                    ? entryPrice * (1 - config.trailingStopPct / 100)
                    : entryPrice * (1 + config.trailingStopPct / 100),
                trailingStopActive: true,
                trailingStopPct: config.trailingStopPct,
                highestPrice: entryPrice, // Initial highest price is entry price
            });
            logDebug(`[ExecuteEntry] Trade ${tradeRecordId} marked as confirmed in TradeTracker.`);
        } catch (err: any) {
            logError(`[ExecuteEntry] ❌ Failed to mark trade ${tradeRecordId} as confirmed in TradeTracker: ${err.message || JSON.stringify(err)}`);
        }
    }


    // Add detailed logging around Redis set operation for pendingExitOrders
    const pendingExitSignal = {
        coin,
        isLong,
        totalQty: tidyQty,
        entryPx: entryPrice,
        pxDecimals,
        szDecimals,
        tpPercents,
        runnerPercent,
        stopLossPercent,
        ts: Date.now(),
        tp1: { price: 0, qty: 0, placed: false },
        tp2: { price: 0, qty: 0, placed: false },
        tp3: { price: 0, qty: 0, placed: false },
        runner: { price: 0, qty: 0, placed: false },
        sl: { price: 0, qty: 0, placed: false },
    };

    try {
        logDebug(`[ExecuteEntry] Attempting to set pendingExitOrders key for ${coin} in Redis.`);
        const redisSetResult = await redis.set(`pendingExitOrders:${coin}`, JSON.stringify(pendingExitSignal), { EX: 300 }); // Expires in 300 seconds (5 minutes)
        logInfo(`[ExecuteEntry] ✅ Pending exit orders key for ${coin} set in Redis. Result: ${redisSetResult}`);
    } catch (redisErr: any) {
        logError(`[ExecuteEntry] ❌ Failed to set pendingExitOrders key for ${coin} in Redis: ${redisErr.message || JSON.stringify(redisErr)}`);
        // Consider if you want to abort the trade or alert if Redis fails here
    }

    try {
        // setTrackedPosition is still used for the active position tracking logic (trailing stop, breakeven)
        await setTrackedPosition(coin, {
            tradeId: tradeRecordId!, // Pass the tradeRecordId here
            qty: tidyQty,
            leverage: risk.leverage,
            entryPrice,
            isLong,
            takeProfitLevels: tpPercents,
            takeProfitHit: [],
            breakevenTriggered: false,
            takeProfitTarget: isLong
                ? entryPrice * (1 + tpPercents[tpPercents.length - 1] / 100)
                : entryPrice * (1 - tpPercents[tpPercents.length - 1] / 100),
            trailingStopTarget: isLong
                ? entryPrice * (1 - config.trailingStopPct / 100)
                : entryPrice * (1 + config.trailingStopPct / 100),
            trailingStopActive: true,
            trailingStopPct: config.trailingStopPct,
            highestPrice: entryPrice,
            openedAt: Date.now(),
        });
        logDebug(`[ExecuteEntry] Tracked position for ${coin} set in Redis.`);
    } catch (trackedPosErr: any) {
        logError(`[ExecuteEntry] ❌ Failed to set tracked position for ${coin} in Redis: ${trackedPosErr.message || JSON.stringify(trackedPosErr)}`);
    }

    logInfo(`[ExecuteEntry] ✅ Placed ${coin} qty=${tidyQty}`);
};
