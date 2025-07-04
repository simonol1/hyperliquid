// src/bot-common/signal-evaluator.ts

import { logInfo } from './utils/logger.js';
import type { Analysis } from './analyse-asset.js';

export interface Signal {
  type: 'BUY' | 'SELL' | 'HOLD';
  strength: number;
}

export const evaluateSignalTrend = (
  asset: string,
  assetData: Analysis,
  config: any
): Signal => {
  const {
    currentPrice,
    fastEma,
    mediumEma,
    slowEma,
    rsi,
    macd,
    macdSignalLine: signal,
    bollingerBands: { upper, lower },
  } = assetData;

  let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

  const canLong = rsi <= (config.rsiOversoldThreshold ?? 30);
  const canShort = rsi >= (config.rsiOverboughtThreshold ?? 70);

  // === New: Combine with trend filter ===
  const upTrend = fastEma > mediumEma && mediumEma > slowEma;
  const downTrend = fastEma < mediumEma && mediumEma < slowEma;

  if (canLong && macd > 0 && upTrend) {
    type = 'BUY';
  } else if (canShort && macd < 0 && downTrend) {
    type = 'SELL';
  }

  // === Only meaningful strength if valid ===
  const strength = type === 'HOLD'
    ? 0
    : Math.abs(rsi - 50) + Math.abs(macd - signal);

  logInfo(
    `[Signal Evaluator] ${asset}: Strategy=TREND | Type=${type} | RSI=${rsi.toFixed(1)} | MACD=${macd.toFixed(2)} | EMAs: Fast=${fastEma.toFixed(2)}, Medium=${mediumEma.toFixed(2)}, Slow=${slowEma.toFixed(2)} | Bands=[${lower.toFixed(2)}-${upper.toFixed(2)}] | Strength=${strength.toFixed(1)}`
  );

  return { type, strength };
};
