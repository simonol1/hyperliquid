import { logInfo } from './utils/logger.js';
import type { Analysis } from './analyse-asset.js';
import type { Signal } from './utils/types.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const evaluateBreakoutSignal = (
    asset: string,
    analysis: Analysis,
    config: BotConfig
): Signal => {
    const { currentPrice, bollingerBands, rsi, macd } = analysis;

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    const upper = bollingerBands.upper;
    const lower = bollingerBands.lower;

    // ✅ BB breakout: must decisively push past the band
    const breakoutBufferPct = 0.005; // 0.5%

    const breaksUpper = currentPrice >= upper * (1 + breakoutBufferPct);
    const breaksLower = currentPrice <= lower * (1 - breakoutBufferPct);

    if (breaksUpper && rsi > config.rsiOverboughtThreshold && macd > 0) {
        type = 'BUY';
    } else if (breaksLower && rsi < config.rsiOversoldThreshold && macd < 0) {
        type = 'SELL';
    }

    let strength = 0;

    if (type !== 'HOLD') {
        const bbDistance =
            type === 'BUY' ? currentPrice - upper : lower - currentPrice;
        const rsiFactor =
            type === 'BUY'
                ? rsi - config.rsiOverboughtThreshold
                : config.rsiOversoldThreshold - rsi;

        strength = (bbDistance * 2) + (rsiFactor * 2);

        if (strength > 100) strength = 100;
        if (strength < 0) strength = 0;
    }

    logInfo(
        `[Signal Evaluator] ${asset}: Strategy=BREAKOUT | Type=${type} | Price=${currentPrice.toFixed(
            2
        )} | BB: [${lower.toFixed(2)} - ${upper.toFixed(2)}] | RSI=${rsi.toFixed(
            1
        )} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)}`
    );

    return { type, strength };
};
