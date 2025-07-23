import { checkTrailingStop, checkTakeProfit } from '../shared-utils/trailing-stop-helpers.js';
import type { Analysis } from '../shared-utils/analyse-asset.js';
import type { BotConfig } from '../bots/config/bot-config.js';
import type { Position } from '../shared-utils/tracked-position.js';
import { ExitIntent } from './execute-exit.js';
import { updateTrackedPosition } from '../shared-utils/tracked-position.js';

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
        await updateTrackedPosition(coin, {
            takeProfitHit: [...(position.takeProfitHit ?? []), ...newHits],
        });
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

    // ✅ Exit if full TP hit (optional – if not fully scaling out)
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
