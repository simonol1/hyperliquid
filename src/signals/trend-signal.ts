import { logInfo, logDebug } from '../shared-utils/logger';
import type { Analysis } from '../shared-utils/analyse-asset';
import type { BaseSignal } from '../shared-utils/types';
import type { BotConfig } from '../bots/config/bot-config';

export const evaluateTrendSignal = (
  asset: string,
  analysis: Analysis,
  config: BotConfig
): BaseSignal => {
  const { fastEma, mediumEma, slowEma, rsi, macd } = analysis;

  let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

  if (!fastEma || !mediumEma || !slowEma) {
    logDebug(`[Signal] ${asset}: Trend | Skipped — missing EMAs`);
    return { type, strength: 0 };
  }

  if (fastEma > mediumEma && mediumEma > slowEma && macd > 0) {
    type = 'BUY';
  } else if (fastEma < mediumEma && mediumEma < slowEma && macd < 0) {
    type = 'SELL';
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
  const output = `[Signal] ${asset} | Trend | Type=${type} | EMAs: F=${fastEma.toFixed(2)} M=${mediumEma.toFixed(2)} S=${slowEma.toFixed(2)} | RSI=${rsi.toFixed(1)} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)}`;

  if (type === 'HOLD') logDebug(output);
  else logInfo(output);

  return { type, strength };
};