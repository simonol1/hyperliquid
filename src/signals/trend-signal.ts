import { logInfo, logDebug } from '../shared-utils/logger';
import type { Analysis } from '../shared-utils/analyse-asset';
import type { BaseSignal } from '../shared-utils/types';
import type { BotConfig } from '../bots/config/bot-config';

interface TrendSignal extends BaseSignal {
  reason?: string;
}

export const evaluateTrendSignal = (
  asset: string,
  analysis: Analysis,
  config: BotConfig
): TrendSignal => {
  const { fastEma, mediumEma, slowEma, rsi, macd } = analysis;

  let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let reason = '';

  if (!fastEma || !mediumEma || !slowEma) {
    reason = 'Missing EMA data';
    logDebug(`[Signal] ${asset}: Trend | Skipped — ${reason}`);
    return { type, strength: 0, reason };
  }

  if (fastEma > mediumEma && mediumEma > slowEma && macd > 0) {
    type = 'BUY';
    reason = 'EMA uptrend alignment with positive MACD';
  } else if (fastEma < mediumEma && mediumEma < slowEma && macd < 0) {
    type = 'SELL';
    reason = 'EMA downtrend alignment with negative MACD';
  } else {
    reason = 'No trend alignment';
  }

  let emaFactor = 0, rsiFactor = 0, macdFactor = 0;
  if (type !== 'HOLD') {
    const emaSpreadPct = ((Math.abs(fastEma - mediumEma) + Math.abs(mediumEma - slowEma)) / slowEma) * 100;
    emaFactor = Math.min(emaSpreadPct * 5, 50);

    const rsiTrend = type === 'BUY'
      ? Math.max(0, rsi - config.rsiOverboughtThreshold)
      : Math.max(0, config.rsiOversoldThreshold - rsi);
    rsiFactor = Math.min((rsiTrend / 10) * 25, 25);

    macdFactor = Math.min(Math.abs(macd), 5) / 5 * 25;
  }

  const strength = Math.min(emaFactor + rsiFactor + macdFactor, 100);
  const output = `[Signal] ${asset} | Trend | Type=${type} | EMAs: F=${fastEma.toFixed(2)} M=${mediumEma.toFixed(2)} S=${slowEma.toFixed(2)} | RSI=${rsi.toFixed(1)} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)} | Reason=${reason}`;

  if (type === 'HOLD') logDebug(output);
  else logInfo(output);

  return { type, strength, reason };
};
