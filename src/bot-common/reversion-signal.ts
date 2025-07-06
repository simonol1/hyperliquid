import { logInfo } from './utils/logger.js';
import type { Analysis } from './analyse-asset.js';
import type { Signal } from './utils/types.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const evaluateReversionSignal = (
    asset: string,
    analysis: Analysis,
    config: BotConfig
): Signal => {
    const { currentPrice, bollingerBands, rsi } = analysis;

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    const lower = bollingerBands.lower;
    const upper = bollingerBands.upper;

    const bandBufferPct = 0.005;
    const lowerThreshold = lower * (1 + bandBufferPct);
    const upperThreshold = upper * (1 - bandBufferPct);

    const nearLower = currentPrice <= lowerThreshold;
    const nearUpper = currentPrice >= upperThreshold;

    // ✅ Allow RSI to be near threshold, not just under/over
    const rsiBuffer = 5;

    const rsiOversold = config.rsiOversoldThreshold + rsiBuffer;
    const rsiOverbought = config.rsiOverboughtThreshold - rsiBuffer;

    if (nearLower && rsi < rsiOversold) {
        type = 'BUY';
    } else if (nearUpper && rsi > rsiOverbought) {
        type = 'SELL';
    }

    let strength = 0;

    if (type !== 'HOLD') {
        const bandDistance =
            type === 'BUY' ? lower - currentPrice : currentPrice - upper;
        const rsiFactor =
            type === 'BUY'
                ? config.rsiOversoldThreshold - rsi
                : rsi - config.rsiOverboughtThreshold;

        // ✅ Tame the strength boost to avoid inflating it
        strength = (Math.abs(bandDistance) * 2) + (rsiFactor * 2);

        if (strength > 100) strength = 100;
        if (strength < 0) strength = 0;
    }

    logInfo(
        `[Signal Evaluator] ${asset}: Strategy=REVERSION | Type=${type} | Price=${currentPrice.toFixed(
            2
        )} | BB: [${lower.toFixed(2)} - ${upper.toFixed(2)}] | RSI=${rsi.toFixed(
            1
        )} | Strength=${strength.toFixed(1)}`
    );

    return { type, strength };
};
