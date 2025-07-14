import { logInfo, logDebug } from '../shared-utils/logger.js';
import type { Analysis } from '../shared-utils/analyse-asset.js';
import type { BaseSignal } from '../shared-utils/types.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const evaluateReversionSignal = (
    asset: string,
    analysis: Analysis,
    config: BotConfig
): BaseSignal => {
    const { currentPrice, slowEma, rsi, macd } = analysis;

    // Allow per-coin distance thresholds
    const overrides = config.coinConfig?.[asset];
    const threshold = overrides?.reversionDistanceThreshold ?? 0.5;
    const maxDistance = overrides?.reversionMaxDistance ?? 5;

    const distanceFromMean = ((currentPrice - slowEma) / slowEma) * 100;

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (distanceFromMean > threshold) type = 'SELL';
    else if (distanceFromMean < -threshold) type = 'BUY';

    let strength = 0;
    if (type !== 'HOLD') {
        const distanceFactor = Math.min(Math.abs(distanceFromMean) / maxDistance * 40, 40);

        let rsiFactor = 0;
        if (type === 'SELL' && rsi > config.rsiOverboughtThreshold) {
            rsiFactor = Math.min((rsi - config.rsiOverboughtThreshold) / 20 * 40, 40);
        } else if (type === 'BUY' && rsi < config.rsiOversoldThreshold) {
            rsiFactor = Math.min((config.rsiOversoldThreshold - rsi) / 20 * 40, 40);
        }

        const macdFactor = Math.min(Math.abs(macd), 5) / 5 * 20;
        strength = distanceFactor + rsiFactor + macdFactor;
        if (strength > 100) strength = 100;
    }

    const output = `[Signal] ${asset} | Reversion | Type=${type} | Distance=${distanceFromMean.toFixed(
        2
    )}% (T=${threshold}) | RSI=${rsi.toFixed(1)} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)}`;

    type === 'HOLD' ? logDebug(output) : logInfo(output);

    return { type, strength };
};
