import { logInfo, logDebug } from '../shared-utils/logger.js';
import type { Analysis } from '../shared-utils/analyse-asset.js';
import type { BaseSignal } from '../shared-utils/types.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const evaluateReversionSignal = (
    asset: string,
    analysis: Analysis,
    config: BotConfig
): BaseSignal & { reason?: string } => {
    const { currentPrice, slowEma, rsi, macd } = analysis;

    if (!slowEma) {
        logDebug(`[Signal] ${asset}: Reversion | Skipped — missing slowEma`);
        return { type: 'HOLD', strength: 0, reason: 'Missing slow EMA' };
    }

    const overrides = config.coinConfig?.[asset];
    const threshold = overrides?.reversionDistanceThreshold ?? 0.5;
    const maxDistance = overrides?.reversionMaxDistance ?? 5;

    const distanceFromMean = ((currentPrice - slowEma) / slowEma) * 100;

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let reason = '';

    if (distanceFromMean > threshold) {
        type = 'SELL';
    } else if (distanceFromMean < -threshold) {
        type = 'BUY';
    } else {
        reason = `Distance ${distanceFromMean.toFixed(2)}% within threshold ±${threshold}%`;
    }

    let distanceFactor = 0, rsiFactor = 0, macdFactor = 0;

    if (type !== 'HOLD') {
        distanceFactor = Math.min((Math.abs(distanceFromMean) / maxDistance) * 50, 50);

        if (type === 'SELL' && rsi > config.rsiOverboughtThreshold) {
            const rsiOver = rsi - config.rsiOverboughtThreshold;
            rsiFactor = Math.min((rsiOver / 20) * 30, 30);
        } else if (type === 'BUY' && rsi < config.rsiOversoldThreshold) {
            const rsiUnder = config.rsiOversoldThreshold - rsi;
            rsiFactor = Math.min((rsiUnder / 20) * 30, 30);
        }

        macdFactor = Math.min(Math.abs(macd), 5) / 5 * 20;
    }

    const strength = Math.min(distanceFactor + rsiFactor + macdFactor, 100);

    const output = `[Signal] ${asset} | Reversion | Type=${type} | Distance=${distanceFromMean.toFixed(
        2
    )}% (T=${threshold}) | RSI=${rsi.toFixed(1)} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)}`;

    type === 'HOLD' ? logDebug(`${output} | Reason=${reason}`) : logInfo(output);

    return { type, strength, reason: type === 'HOLD' ? reason : undefined };
};
