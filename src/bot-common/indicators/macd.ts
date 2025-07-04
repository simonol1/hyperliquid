import { AnalyzeConfig } from '../analyse-asset.js';
import { calculateEMA } from './ema.js';

export interface MACDResult {
  macd: number;
  signal: number;
}

export const calculateMACD = (
  closes: number[],
  config: AnalyzeConfig,
): MACDResult => {
  const { macdFastPeriod, macdSlowPeriod, macdSignalPeriod } = config
  const shortEMA: number = calculateEMA(closes.slice(-macdFastPeriod), macdFastPeriod);
  const longEMA: number = calculateEMA(closes.slice(-macdSlowPeriod), macdSlowPeriod);
  const macd: number = shortEMA - longEMA;

  // Approximate signal line using previous MACD values for simplicity
  const previousMACD: number[] = closes
    .slice(-macdSlowPeriod)
    .map(
      (_, i) =>
        calculateEMA(closes.slice(i, i + macdFastPeriod), macdFastPeriod) -
        calculateEMA(closes.slice(i, i + macdSlowPeriod), macdSlowPeriod)
    );

  const signal: number = calculateEMA(previousMACD, macdSignalPeriod);
  return { macd, signal };
};
