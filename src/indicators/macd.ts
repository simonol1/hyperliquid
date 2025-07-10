import { calculateEMA } from './ema.js';

export interface MACDResult {
  macd: number;
  signal: number;
}

export const calculateMACD = (
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number
): MACDResult => {

  const shortEMA = calculateEMA(closes, fastPeriod);
  const longEMA = calculateEMA(closes, slowPeriod);
  const macd = shortEMA - longEMA;

  // For signal line, roll MACD values (simple approx)
  const macdHistory = closes
    .slice(-slowPeriod)
    .map((_, i) => {
      const slice = closes.slice(i, i + slowPeriod);
      return calculateEMA(slice, fastPeriod) - calculateEMA(slice, slowPeriod);
    });

  const signal = calculateEMA(macdHistory, signalPeriod);
  return { macd, signal };
};
