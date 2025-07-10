import type { Candle, Hyperliquid } from '../sdk/index.js';
import { calculateEMA } from '../indicators/ema.js';
import { calculateRSI } from '../indicators/rsi.js';
import { calculateMACD } from '../indicators/macd.js';
import { calculateBollingerBands } from '../indicators/bollinger.js';
import { getIntervalMs } from './utils.js';
import { logDebug, logInfo, logError, logAnalysis } from './logger.js';
import { BotConfig } from '../bots/config/bot-config.js';

export interface Analysis {
  currentPrice: number;
  closes: number[];
  fastEma?: number;
  mediumEma?: number;
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

    const emaFast = config.emaFastPeriod;
    const emaMedium = config.emaMediumPeriod;
    const emaSlow = config.emaSlowPeriod ?? 50;

    const rsiPeriod = config.rsiPeriod ?? 14;
    const macdFast = config.macdFastPeriod;
    const macdSlow = config.macdSlowPeriod;
    const macdSignal = config.macdSignalPeriod;
    const bollingerPeriod = config.bollingerPeriod ?? 20;

    if (!macdFast || !macdSlow || !macdSignal) {
      throw new Error(`[AnalyseData] MACD periods missing in config for ${asset}`);
    }

    const longestEma = Math.max(emaFast || 0, emaMedium || 0, emaSlow);
    const candleCount = Math.max(
      100,
      longestEma,
      rsiPeriod,
      macdFast + macdSlow + macdSignal,
      bollingerPeriod
    ) + 50;

    const startTimeMs = endTimeMs - intervalMs * candleCount;

    logDebug(`[AnalyseData] ⏳ Fetch ${candleCount} candles for ${asset} (${config.timeframe})`);

    const candles = await hyperliquid.info.getCandleSnapshot(
      asset,
      config.timeframe,
      startTimeMs,
      endTimeMs
    );

    if (!candles || candles.length === 0) {
      logInfo(`[AnalyseData] ⚠️ No candles returned for ${asset}`);
      return null;
    }

    const closes = candles.map((c: Candle) => c.c);
    const price = closes.at(-1);
    if (!price) {
      logError(`[AnalyseData] ❌ Invalid last price for ${asset}`);
      return null;
    }

    const fastEma = emaFast ? calculateEMA(closes, emaFast) : undefined;
    const mediumEma = emaMedium ? calculateEMA(closes, emaMedium) : undefined;
    const slowEma = calculateEMA(closes, emaSlow);

    const rsi = calculateRSI(closes, rsiPeriod);
    const { macd, signal: macdSignalLine } = calculateMACD(closes, macdFast, macdSlow, macdSignal);
    const bollingerBands = calculateBollingerBands(closes, bollingerPeriod);

    const analysis: Analysis = {
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

    logAnalysis(asset, analysis);
    return analysis;

  } catch (err: any) {
    logError(`[AnalyseData] ❌ ${asset} → ${err.message}`);
    return null;
  }
};
