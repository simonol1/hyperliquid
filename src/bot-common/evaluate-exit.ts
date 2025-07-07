import type { ExitIntent, Position } from './trade-executor';
import type { Analysis } from './analyse-asset';
import type { BotConfig } from '../bots/config/bot-config';
import { checkTrailingStop, checkTakeProfit } from '../bot-common/utils/trailing-stop-helpers';

export const evaluateExit = async (
  position: Position,
  analysis: Analysis,
  config: BotConfig
): Promise<ExitIntent | null> => {
  const shouldExit =
    checkTrailingStop(position, analysis, config) ||
    checkTakeProfit(position, analysis, config);

  if (!shouldExit) return null;

  return {
    quantity: position.qty,
    price: analysis.currentPrice,
    type: 'EXIT',
    reason: 'TrailingStopOrTP'
  };
};
