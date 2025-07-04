import { BotConfig } from '../bots/config/bot-config.js';
import { Analysis } from './analyse-asset.js';
import { ExitIntent, Position } from './trade-executor.js';

export const evaluateExit = (
  position: Position,
  analysis: Analysis,
  config: BotConfig
): ExitIntent | null => {
  const { entryPrice, qty } = position;

  const dropPct = ((position.highestPrice - analysis.currentPrice) / position.highestPrice) * 100;
  const gainPct = ((analysis.currentPrice - entryPrice) / entryPrice) * 100;

  if (dropPct >= config.trailingStopPct) {
    return {
      quantity: qty,
      price: analysis.currentPrice,
      type: 'EXIT',
      reason: `TrailingStop ${dropPct.toFixed(2)}%`,
    };
  }

  if (gainPct >= config.initialTakeProfitPct) {
    return {
      quantity: qty,
      price: analysis.currentPrice,
      type: 'EXIT',
      reason: `TakeProfit ${gainPct.toFixed(2)}%`,
    };
  }

  return null;
};
