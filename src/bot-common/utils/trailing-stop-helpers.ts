import { BotConfig } from "../../bots/config/bot-config";
import { Analysis } from "../analyse-asset";
import { Position } from "../trade-executor";

export const checkTrailingStop = (position: Position, analysis: Analysis, config: BotConfig): boolean => {
    const dropPct = ((position.highestPrice - analysis.currentPrice) / position.highestPrice) * 100;
    return dropPct >= (config.trailingStopPct ?? 0);
};

export const checkTakeProfit = (position: Position, analysis: Analysis, config: BotConfig): boolean => {
    const gainPct = ((analysis.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    return gainPct >= (config.initialTakeProfitPct ?? 0);
};