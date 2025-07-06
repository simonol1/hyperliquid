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

  // ✅ Classic trend cross: Fast EMA crosses Medium + Slow, MACD positive
  const bullish = fastEma > mediumEma && mediumEma > slowEma && macd > 0;
  const bearish = fastEma < mediumEma && mediumEma < slowEma && macd < 0;

  if (bullish && rsi < config.rsiOverboughtThreshold) {
    type = 'BUY';
  } else if (bearish && rsi > config.rsiOversoldThreshold) {
    type = 'SELL';
  }

  let strength = 0;

  if (type !== 'HOLD') {
    const emaGap = Math.abs(fastEma - mediumEma) + Math.abs(mediumEma - slowEma);
    const macdFactor = Math.abs(macd);
    const rsiDistance =
      type === 'BUY'
        ? config.rsiOverboughtThreshold - rsi
        : rsi - config.rsiOversoldThreshold;

    strength = emaGap + macdFactor + rsiDistance;

    if (strength > 100) strength = 100;
    if (strength < 0) strength = 0;
  }

  logInfo(
    `[Signal Evaluator] ${asset}: Strategy=TREND | Type=${type} | EMAs: Fast=${fastEma.toFixed(
      2
    )}, Medium=${mediumEma.toFixed(2)}, Slow=${slowEma.toFixed(
      2
    )} | RSI=${rsi.toFixed(1)} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)}`
  );

  return { type, strength };
};
