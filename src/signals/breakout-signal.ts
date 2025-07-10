import { logInfo, logDebug } from '../shared-utils/logger.js';
import type { Analysis } from '../shared-utils/analyse-asset.js';
import type { BaseSignal } from '../shared-utils/types.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const evaluateBreakoutSignal = (
    asset: string,
    analysis: Analysis,
    config: BotConfig
): BaseSignal => {
    const { currentPrice, bollingerBands, rsi, macd } = analysis;

    const upper = bollingerBands.upper;
    const lower = bollingerBands.lower;

    const breakoutBufferPct = 0.005;

    const breaksUpper = currentPrice >= upper * (1 + breakoutBufferPct);
    const breaksLower = currentPrice <= lower * (1 - breakoutBufferPct);

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (breaksUpper && rsi > config.rsiOverboughtThreshold && macd > 0) {
        type = 'BUY';
    } else if (breaksLower && rsi < config.rsiOversoldThreshold && macd < 0) {
        type = 'SELL';
    } else {
        const nearUpper = currentPrice >= upper * 0.99;
        const nearLower = currentPrice <= lower * 1.01;

        if (nearUpper && rsi > config.rsiOverboughtThreshold - 5) {
            type = 'BUY';
        } else if (nearLower && rsi < config.rsiOversoldThreshold + 5) {
            type = 'SELL';
        }
    }

    let bbFactor = 0;
    let rsiFactor = 0;
    let macdFactor = 0;

    if (type === 'BUY') {
        const bbBreakPct = ((currentPrice - upper) / upper) * 100;
        bbFactor = Math.min(Math.max(bbBreakPct, 0) / 2, 40);

        const rsiOver = Math.max(rsi - config.rsiOverboughtThreshold, 0);
        rsiFactor = Math.min((rsiOver / 10) * 30, 30);

        macdFactor = Math.min(Math.abs(macd), 5) / 5 * 30;
    } else if (type === 'SELL') {
        const bbBreakPct = ((lower - currentPrice) / lower) * 100;
        bbFactor = Math.min(Math.max(bbBreakPct, 0) / 2, 40);

        const rsiUnder = Math.max(config.rsiOversoldThreshold - rsi, 0);
        rsiFactor = Math.min((rsiUnder / 10) * 30, 30);

        macdFactor = Math.min(Math.abs(macd), 5) / 5 * 30;
    }

    const strength = Math.min(bbFactor + rsiFactor + macdFactor, 100);

    const output = `[Signal] ${asset} | Breakout | Type=${type} | Price=${currentPrice.toFixed(
        2
    )} | BB:[${lower.toFixed(2)}-${upper.toFixed(2)}] | RSI=${rsi.toFixed(
        1
    )} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)}`;

    if (type === 'HOLD') {
        logDebug(output);
    } else {
        logInfo(output);
    }

    return { type, strength };
};
