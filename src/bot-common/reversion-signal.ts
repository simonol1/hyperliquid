import { logInfo } from './utils/logger.js';
import type { Analysis } from './analyse-asset.js';
import type { Signal } from './utils/types.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const evaluateReversionSignal = (
    asset: string,
    analysis: Analysis,
    config: BotConfig
): Signal => {
    const { currentPrice, slowEma, rsi, macd } = analysis;

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    const distanceFromMean = ((currentPrice - slowEma) / slowEma) * 100;

    // ✅ New logic: distance alone decides type
    if (distanceFromMean > 0.5) {
        type = 'SELL';
    } else if (distanceFromMean < -0.5) {
        type = 'BUY';
    }

    let strength = 0;

    if (type !== 'HOLD') {
        const distanceFactor = Math.abs(distanceFromMean) * 20;

        // RSI boosts if it aligns
        let rsiFactor = 0;
        if (type === 'SELL' && rsi > config.rsiOverboughtThreshold) {
            rsiFactor = (rsi - config.rsiOverboughtThreshold) * 1.5;
        } else if (type === 'BUY' && rsi < config.rsiOversoldThreshold) {
            rsiFactor = (config.rsiOversoldThreshold - rsi) * 1.5;
        }

        const macdFactor = Math.abs(macd);

        strength = distanceFactor + rsiFactor + macdFactor;

        if (strength > 100) strength = 100;
    }

    logInfo(
        `[Signal Evaluator] ${asset}: Strategy=REVERSION | Type=${type} | Price=${currentPrice.toFixed(
            2
        )} | EMA Slow=${slowEma.toFixed(2)} | Distance=${distanceFromMean.toFixed(
            2
        )}% | RSI=${rsi.toFixed(1)} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)}`
    );

    return { type, strength };
};

