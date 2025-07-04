import type { Candle, Hyperliquid } from '../sdk/index.js';
import { calculateEMA } from './indicators/ema.js';
import { calculateRSI } from './indicators/rsi.js';
import { calculateMACD } from './indicators/macd.js';
import { calculateBollingerBands } from './indicators/bollinger.js';
import { getIntervalMs } from './utils/utils.js';
import { logInfo, logError } from './utils/logger.js';
import { BotConfig } from '../bots/config/bot-config.js';

export interface Analysis {
  currentPrice: number;
  closes: number[];
  fastEma: number;
  mediumEma: number;
  slowEma: number;
  rsi: number;
  macd: number;
  macdSignalLine: number;
  bollingerBands: {
    lower: number;
    upper: number;
  };
}

export const analyseData = async (
  hyperliquid: Hyperliquid,
  asset: string,
  config: BotConfig
): Promise<Analysis | null> => {
  try {
    const intervalMs = getIntervalMs(config.timeframe);
    const endTimeMs = Date.now() - 60_000;

    const longestEma = Math.max(
      config.emaFastPeriod || 10,
      config.emaMediumPeriod || 20,
      config.emaSlowPeriod || 200
    );

    const candleCount = Math.max(
      100,
      longestEma,
      config.rsiPeriod,
      config.macdFastPeriod + config.macdSlowPeriod + config.macdSignalPeriod,
      config.bollingerPeriod || 20
    ) + 50;

    const startTimeMs = endTimeMs - intervalMs * candleCount;

    logInfo(
      `[AnalyseData] Fetching ${candleCount} candles for ${asset} (${config.timeframe}) from ${new Date(
        startTimeMs
      ).toLocaleTimeString()} to ${new Date(endTimeMs).toLocaleTimeString()}`
    );

    const candles = await hyperliquid.info.getCandleSnapshot(
      asset,
      config.timeframe,
      startTimeMs,
      endTimeMs
    );

    if (!candles || candles.length === 0) {
      logInfo(`[AnalyseData] No candles fetched for ${asset}.`);
      return null;
    }

    const closes = candles.map((c: Candle) => c.c);
    const price = closes.at(-1);

    if (!price) {
      logError(`[AnalyseData] Invalid price for ${asset}.`);
      return null;
    }

    const fastEma = calculateEMA(closes, config.emaFastPeriod);
    const mediumEma = calculateEMA(closes, config.emaMediumPeriod);
    const slowEma = calculateEMA(closes, config.emaSlowPeriod);

    const rsi = calculateRSI(closes, config.rsiPeriod);
    const { macd, signal: macdSignalLine } = calculateMACD(closes, config);
    const bollingerBands = calculateBollingerBands(closes, config.bollingerPeriod || 20);

    logInfo(
      `[AnalyseData] ${asset} | Price: ${price.toFixed(2)} | EMAs: Fast(${config.emaFastPeriod}): ${fastEma.toFixed(
        2
      )} | Medium(${config.emaMediumPeriod}): ${mediumEma.toFixed(
        2
      )} | Slow(${config.emaSlowPeriod}): ${slowEma.toFixed(
        2
      )} | RSI(${config.rsiPeriod}): ${rsi.toFixed(1)} | MACD: ${macd.toFixed(
        2
      )} | BB: [${bollingerBands.lower.toFixed(2)} - ${bollingerBands.upper.toFixed(2)}]`
    );

    return {
      currentPrice: price,
      closes,
      fastEma,
      mediumEma,
      slowEma,
      rsi,
      macd,
      macdSignalLine,
      bollingerBands,
    };
  } catch (err: any) {
    logError(`[AnalyseData] Error for ${asset}: ${err.message}`);
    return null;
  }
};
