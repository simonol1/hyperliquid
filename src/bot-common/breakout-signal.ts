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

    const upper = bollingerBands.upper;
    const lower = bollingerBands.lower;

    const breakoutBufferPct = 0.005; // 0.5%

    const aboveUpper = currentPrice - upper;
    const belowLower = lower - currentPrice;

    const breaksUpper = currentPrice >= upper * (1 + breakoutBufferPct);
    const breaksLower = currentPrice <= lower * (1 - breakoutBufferPct);

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (breaksUpper && rsi > config.rsiOverboughtThreshold && macd > 0) {
        type = 'BUY';
    } else if (breaksLower && rsi < config.rsiOversoldThreshold && macd < 0) {
        type = 'SELL';
    } else {
        // If no clear breakout, check if we're near the band edges → hint at possible breakout
        const nearUpper = currentPrice > upper * 0.99;
        const nearLower = currentPrice < lower * 1.01;

        if (nearUpper && rsi > config.rsiOverboughtThreshold - 5) {
            type = 'BUY';
        } else if (nearLower && rsi < config.rsiOversoldThreshold + 5) {
            type = 'SELL';
        }
    }

    // === New: always produce a continuous score
    let bbDistancePct = 0;
    if (type === 'BUY') {
        bbDistancePct = ((currentPrice - upper) / upper) * 100;
    } else if (type === 'SELL') {
        bbDistancePct = ((lower - currentPrice) / lower) * 100;
    }

    const rsiDistance =
        type === 'BUY'
            ? rsi - config.rsiOverboughtThreshold
            : config.rsiOversoldThreshold - rsi;

    const macdFactor = Math.abs(macd);

    let strength = 0;
    if (type !== 'HOLD') {
        strength =
            Math.max(0, bbDistancePct * 50) +
            Math.max(0, rsiDistance * 1.5) +
            macdFactor * 5;
    }

    if (strength > 100) strength = 100;

    logInfo(
        `[Signal Evaluator] ${asset}: Strategy=BREAKOUT | Type=${type} | Price=${currentPrice.toFixed(
            2
        )} | BB: [${lower.toFixed(2)} - ${upper.toFixed(2)}] | RSI=${rsi.toFixed(
            1
        )} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)}`
    );

    return { type, strength };
};

