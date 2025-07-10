import { checkTrailingStop, checkTakeProfit } from '../shared-utils/trailing-stop-helpers.js';
import type { Analysis } from '../shared-utils/analyse-asset.js';
import type { BotConfig } from '../bots/config/bot-config.js';
import { ExitIntent } from './execute-exit.js';

export interface Position {
    qty: number;
    entryPrice: number;
    highestPrice: number;
    isShort: boolean;
    takeProfitTarget?: number;
}

export const evaluateExit = (
    position: Position,
    analysis: Analysis,
    config: BotConfig
): ExitIntent | null => {
    const shouldExit =
        checkTrailingStop(position, analysis, config) ||
        checkTakeProfit(position, analysis, config);

    if (!shouldExit) return null;

    return {
        quantity: position.qty,
        price: analysis.currentPrice,
        type: 'EXIT',
        reason: 'TrailingStopOrTP',
    };
};
