import { logInfo } from './logger.js';
import type { Position } from '../core/evaluate-exit.js';
import type { Analysis } from './analyse-asset.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const checkTrailingStop = (
    position: Position,
    analysis: Analysis,
    config: BotConfig
): boolean => {
    const { currentPrice } = analysis;
    const { isLong, highestPrice } = position;
    const trailingPct = config.trailingStopPct ?? 0;

    if (trailingPct <= 0 || !highestPrice) return false;

    const trailingStop = isLong
        ? highestPrice * (1 - trailingPct / 100)
        : highestPrice * (1 + trailingPct / 100);

    const hit = isLong
        ? currentPrice <= trailingStop
        : currentPrice >= trailingStop;

    logInfo(`[Trailing SL] ${isLong ? 'LONG' : 'SHORT'} position | Current: ${currentPrice} | Watermark: ${highestPrice} | Trigger: ${trailingStop.toFixed(4)} | Hit: ${hit ? '✅' : '—'}`);

    return hit;
};



export const checkTakeProfit = (
    position: Position,
    analysis: Analysis
): boolean => {
    if (!position.takeProfitTarget) return false;

    const { currentPrice } = analysis;
    const { isLong, takeProfitTarget } = position;

    return isLong
        ? currentPrice >= takeProfitTarget
        : currentPrice <= takeProfitTarget;
};
