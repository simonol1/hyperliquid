import { checkTrailingStop, checkTakeProfit } from '../shared-utils/trailing-stop-helpers.js';
import type { Analysis } from '../shared-utils/analyse-asset.js';
import type { BotConfig } from '../bots/config/bot-config.js';
import { ExitIntent } from './execute-exit.js';

export interface Position {
    qty: number;
    entryPrice: number;
    highestPrice: number;
    isLong: boolean;
    takeProfitTarget?: number;
    trailingStopTarget?: number;
}

export const evaluateExit = (
    position: Position,
    analysis: Analysis,
    config: BotConfig
): ExitIntent | null => {
    if (checkTrailingStop(position, analysis, config)) {
        return {
            quantity: position.qty,
            price: analysis.currentPrice,
            type: 'EXIT',
            reason: `TrailingStop (${config.trailingStopPct}%)`,
        };
    }

    if (checkTakeProfit(position, analysis)) {
        return {
            quantity: position.qty,
            price: analysis.currentPrice,
            type: 'EXIT',
            reason: `TakeProfit hit`,
        };
    }

    return null;
};

