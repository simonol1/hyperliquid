import type { Candle, Hyperliquid } from '../sdk/index.js';
import { calculateEMA } from '../indicators/ema.js';
import { calculateRSI } from '../indicators/rsi.js';
import { calculateMACD } from '../indicators/macd.js';
import { calculateBollingerBands } from '../indicators/bollinger.js';
import { getIntervalMs } from './utils.js';
import { logDebug, logInfo, logError, logAnalysis } from './logger.js';
import { BotConfig } from '../bots/config/bot-config.js';

const DEFAULT_LOOKBACK = 50;

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
  volumeUsd: number;
  highEffectiveLevel?: number;
  lowEffectiveLevel?: number;
  atr: number // average true range
}

export const analyseData = async (
  hyperliquid: Hyperliquid,
  asset: string,
  config: BotConfig,
): Promise<Analysis | null> => {
  try {
    const overrides = config.coinConfig?.[asset];
    const timeframe = overrides?.timeframe ?? config.timeframe;
    const intervalMs = getIntervalMs(timeframe);
    const endTimeMs = Date.now() - 60_000;

    const emaFast = config.emaFastPeriod;
    const emaMedium = config.emaMediumPeriod;
    const emaSlow = config.emaSlowPeriod;

    const rsiPeriod = config.rsiPeriod;
    const macdFast = config.macdFastPeriod;
    const macdSlow = config.macdSlowPeriod;
    const macdSignal = config.macdSignalPeriod;
    const bollingerPeriod = config.bollingerPeriod ?? 20;

    const effectiveLookback = overrides?.lookback ?? DEFAULT_LOOKBACK;

    // Candle count logic—large enough to support all indicators
    const indicatorLookback = Math.max(
      emaFast ?? 0,
      emaMedium ?? 0,
      emaSlow,
      rsiPeriod,
      macdFast + macdSlow + macdSignal,
      bollingerPeriod,
      effectiveLookback
    );

    const candleCount = indicatorLookback + 50;
    const startTimeMs = endTimeMs - intervalMs * candleCount;

    logDebug(`[AnalyseData] ⏳ Fetch ${candleCount} candles for ${asset} (${timeframe})`);

    const candles = await hyperliquid.info.getCandleSnapshot(asset, timeframe, startTimeMs, endTimeMs);
    if (!candles || candles.length === 0) {
      logInfo(`[AnalyseData] ⚠️ No candles returned for ${asset}`);
      return null;
    }

    const closes = candles.map((candle: Candle) => candle.c);
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

    const recentCandles = candles.slice(-effectiveLookback);
    const highEffectiveLevel = Math.max(...closes.slice(-effectiveLookback));
    const lowEffectiveLevel = Math.min(...closes.slice(-effectiveLookback));

    const totalVolumeInUsd = recentCandles
      .map(candle => {
        const volumeInUnits = candle.v ?? 0;
        const closePriceInUsd = candle.c ?? price;
        return volumeInUnits * closePriceInUsd;
      })
      .reduce((sum, volumeInUsd) => sum + volumeInUsd, 0);

    const volumeUsd = totalVolumeInUsd / effectiveLookback;

    const atrPeriod = Math.min(40, Math.max(10, Math.floor(effectiveLookback / 3)));
    const atr = calculateATR(candles, atrPeriod);

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
      highEffectiveLevel,
      lowEffectiveLevel,
      volumeUsd,
      atr
    };

    logAnalysis(asset, analysis);
    return analysis;

  } catch (err: any) {
    logError(`[AnalyseData] ❌ ${asset} → ${err.message}`);
    return null;
  }
};

export const calculateATR = (candles: Candle[], period: number = 14): number => {
  const trs = candles.slice(1).map((c, i) => {
    const prevClose = candles[i].c;
    const high = c.h, low = c.l, close = c.c;
    return Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
  });
  const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  return atr;
};
