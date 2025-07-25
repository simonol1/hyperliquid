// ✅ evaluate-exit.ts
import { checkTrailingStop, checkTakeProfit } from '../shared-utils/trailing-stop-helpers.js';
import type { Analysis } from '../shared-utils/analyse-asset.js';
import type { BotConfig } from '../bots/config/bot-config.js';
import type { Position } from '../shared-utils/tracked-position.js';
import { ExitIntent } from './execute-exit.js'; // Ensure ExitIntent is correctly imported
import { updateTrackedPosition } from '../shared-utils/tracked-position.js'; // Ensure getTrackedPosition is imported
import { logInfo } from '../shared-utils/logger.js'; // Ensure all logger functions are imported
import type { Hyperliquid } from '../sdk/index.js'; // Import Hyperliquid
import { redis } from '../shared-utils/redis-client.js'; // Import redis

export const evaluateExit = async (
    hyperliquid: Hyperliquid, // Pass hyperliquid instance to evaluateExit
    position: Position,
    analysis: Analysis,
    config: BotConfig,
    coin: string
): Promise<ExitIntent | null> => {
    const { currentPrice } = analysis;
    const { entryPrice } = position;

    // Fetch the real-time position from Hyperliquid to get the most accurate current quantity
    const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(config.subaccountAddress);
    const realPosition = perpState.assetPositions.find(
        (p) => p.position.coin === coin && Math.abs(parseFloat(p.position.szi)) > 0
    );

    if (!realPosition) {
        // If no real position is found but we still have a tracked position, it means it was closed externally.
        // Clean up the tracked position and pending exit orders.
        logInfo(`[EvaluateExit] Position for ${coin} not found on exchange. Clearing tracked state.`);
        await redis.del(`trackedPosition:${coin}`);
        await redis.del(`pendingExitOrders:${coin}`);
        return null; // No exit intent needed, position is already gone.
    }

    const currentQtyOnExchange = Math.abs(parseFloat(realPosition.position.szi));

    // ✅ Check for new TP hits
    const tolerance = entryPrice * 0.001; // 0.1% wiggle room for TP hit detection
    const hitLevels = (position.takeProfitLevels ?? []).filter(level => {
        const targetPx = position.isLong
            ? entryPrice * (1 + level / 100)
            : entryPrice * (1 - level / 100);
        return Math.abs(currentPrice - targetPx) <= tolerance;
    });

    const newHits = hitLevels.filter(
        level => !(position.takeProfitHit ?? []).includes(level)
    );

    if (newHits.length > 0) {
        const updatedHits = new Set([
            ...(position.takeProfitHit ?? []),
            ...newHits,
        ]);

        await updateTrackedPosition(coin, {
            takeProfitHit: Array.from(updatedHits),
        });

        for (const level of newHits) {
            const targetPx = position.isLong
                ? entryPrice * (1 + level / 100)
                : entryPrice * (1 - level / 100);

            logInfo(`[TP-Hit] ${coin} hit ${level}% → ${targetPx.toFixed(4)}`);
        }
    }

    // ✅ Promote SL to breakeven after first TP hit
    const firstTp = position.takeProfitLevels?.[0];
    if (
        firstTp !== undefined &&
        (position.takeProfitHit ?? []).includes(firstTp) &&
        !position.breakevenTriggered
    ) {
        const breakevenPx = position.entryPrice;
        await updateTrackedPosition(coin, {
            trailingStopTarget: breakevenPx,
            breakevenTriggered: true,
        });

        logInfo(`[Breakeven] Promoting SL to breakeven for ${coin} @ ${breakevenPx.toFixed(4)}`);
    }

    // ✅ Exit if trailing stop hit
    // This is a market exit, so it closes the entire remaining position.
    if (checkTrailingStop(position, analysis, config)) {
        logInfo(`[EvaluateExit] Trailing stop hit for ${coin}. Preparing full exit.`);
        return {
            quantity: currentQtyOnExchange, // Pass the current quantity from exchange
            price: currentPrice,
            type: 'EXIT', // General exit type
            reason: `TrailingStop (${config.trailingStopPct}%)`,
        };
    }

    // ✅ Exit if full TP hit (all TP levels including runner have been conceptually hit)
    // This implies the final portion of the position (the runner) should be closed.
    if (checkTakeProfit(position, analysis)) {
        logInfo(`[EvaluateExit] All Take Profits hit for ${coin}. Preparing final runner exit.`);
        return {
            quantity: currentQtyOnExchange, // Pass the current quantity from exchange
            price: currentPrice,
            type: 'EXIT', // General exit type
            reason: `TakeProfit hit (final runner)`,
        };
    }

    return null; // No exit intent at this time
};
