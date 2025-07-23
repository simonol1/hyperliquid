// --- evaluate-exit.ts ---
import { checkTrailingStop, checkTakeProfit } from '../shared-utils/trailing-stop-helpers.js';
import type { Analysis } from '../shared-utils/analyse-asset.js';
import type { BotConfig } from '../bots/config/bot-config.js';
import type { Position } from '../shared-utils/tracked-position.js';
import { ExitIntent } from './execute-exit.js';
import { updateTrackedPosition } from '../shared-utils/tracked-position.js';
import { logInfo } from '../shared-utils/logger.js';

export const evaluateExit = async (
    position: Position,
    analysis: Analysis,
    config: BotConfig,
    coin: string
): Promise<ExitIntent | null> => {
    const { currentPrice } = analysis;
    const { entryPrice } = position;

    // ✅ Check for new TP hits
    const tolerance = entryPrice * 0.001; // 0.1% wiggle room
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
    if (checkTrailingStop(position, analysis, config)) {
        return {
            quantity: position.qty,
            price: currentPrice,
            type: 'EXIT',
            reason: `TrailingStop (${config.trailingStopPct}%)`,
        };
    }

    // ✅ Exit if full TP hit
    if (checkTakeProfit(position, analysis)) {
        return {
            quantity: position.qty,
            price: currentPrice,
            type: 'EXIT',
            reason: `TakeProfit hit`,
        };
    }

    return null;
};
