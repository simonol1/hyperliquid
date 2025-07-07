import { logInfo } from './utils/logger.js';
import type { Analysis } from './analyse-asset.js';
import type { Signal } from './utils/types.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const evaluateTrendSignal = (
  asset: string,
  analysis: Analysis,
  config: BotConfig
): Signal => {
  const { fastEma, mediumEma, slowEma, rsi, macd } = analysis;

  let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

  // ✅ Example logic: classic trend confirmation
  if (fastEma > mediumEma && mediumEma > slowEma && macd > 0) {
    type = 'BUY';
  } else if (fastEma < mediumEma && mediumEma < slowEma && macd < 0) {
    type = 'SELL';
  }

  // === Calculate trending strength
  let emaGap = 0;
  if (type !== 'HOLD') {
    const emaStack = Math.abs(fastEma - mediumEma) + Math.abs(mediumEma - slowEma);
    emaGap = emaStack / slowEma * 100; // normalize
  }

  const rsiContribution = type === 'BUY'
    ? rsi - 50
    : 50 - rsi;

  const macdContribution = Math.abs(macd);

  let strength = 0;
  if (type !== 'HOLD') {
    strength =
      emaGap * 10 + // EMA separation is king
      Math.max(0, rsiContribution) * 1.5 + // RSI trending with direction
      macdContribution * 3;

    if (strength > 100) strength = 100;
  }

  logInfo(
    `[Signal Evaluator] ${asset}: Strategy=TREND | Type=${type} | EMAs: Fast=${fastEma.toFixed(
      2
    )}, Medium=${mediumEma.toFixed(2)}, Slow=${slowEma.toFixed(2)} | RSI=${rsi.toFixed(
      1
    )} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)}`
  );

  return { type, strength };
};

