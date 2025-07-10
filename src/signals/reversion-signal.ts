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

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    const distanceFromMean = ((currentPrice - slowEma) / slowEma) * 100;

    if (distanceFromMean > 0.5) {
        type = 'SELL';
    } else if (distanceFromMean < -0.5) {
        type = 'BUY';
    }

    let strength = 0;

    if (type !== 'HOLD') {
        const absDistance = Math.abs(distanceFromMean);
        const maxDistance = 5;
        const distanceFactor = Math.min((absDistance / maxDistance) * 40, 40);

        let rsiFactor = 0;
        if (type === 'SELL' && rsi > config.rsiOverboughtThreshold) {
            const rsiOver = Math.min(rsi - config.rsiOverboughtThreshold, 20);
            rsiFactor = (rsiOver / 20) * 40;
        } else if (type === 'BUY' && rsi < config.rsiOversoldThreshold) {
            const rsiUnder = Math.min(config.rsiOversoldThreshold - rsi, 20);
            rsiFactor = (rsiUnder / 20) * 40;
        }

        const macdStrength = Math.min(Math.abs(macd), 5);
        const macdFactor = (macdStrength / 5) * 20;

        strength = distanceFactor + rsiFactor + macdFactor;

        if (strength > 100) strength = 100;
    }

    const output = `[Signal] ${asset} | Reversion | Type=${type} | Price=${currentPrice.toFixed(
        2
    )} | SlowEMA=${slowEma.toFixed(2)} | Distance=${distanceFromMean.toFixed(
        2
    )}% | RSI=${rsi.toFixed(1)} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)}`;

    if (type === 'HOLD') {
        logDebug(output);
    } else {
        logInfo(output);
    }

    return { type, strength };
};
