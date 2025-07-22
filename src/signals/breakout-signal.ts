import { BotConfig } from "../bots/config/bot-config";
import { Analysis } from "../shared-utils/analyse-asset";
import { logDebug, logInfo } from "../shared-utils/logger";
import { BaseSignal } from "../shared-utils/types";

export const evaluateBreakoutSignal = (
    asset: string,
    analysis: Analysis,
    config: BotConfig
): BaseSignal => {
    const { currentPrice, bollingerBands, rsi, macd } = analysis;

    if (!bollingerBands?.upper || !bollingerBands?.lower) {
        logDebug(`[Signal] ${asset}: Breakout | Skipped — missing Bollinger Bands`);
        return { type: 'HOLD', strength: 0, reason: 'Missing Bollinger Bands' };
    }

    const upper = bollingerBands.upper;
    const lower = bollingerBands.lower;
    const breakoutBufferPct = 0.005;

    const breaksUpper = currentPrice >= upper * (1 + breakoutBufferPct);
    const breaksLower = currentPrice <= lower * (1 - breakoutBufferPct);

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let reason = 'No breakout condition met';

    if (breaksUpper && rsi > config.rsiOverboughtThreshold && macd > 0) {
        type = 'BUY';
        reason = 'Breaks upper band with RSI and MACD alignment';
    } else if (breaksLower && rsi < config.rsiOversoldThreshold && macd < 0) {
        type = 'SELL';
        reason = 'Breaks lower band with RSI and MACD alignment';
    } else {
        const nearUpper = currentPrice >= upper * 0.99;
        const nearLower = currentPrice <= lower * 1.01;

        if (nearUpper && rsi > config.rsiOverboughtThreshold - 5) {
            type = 'BUY';
            reason = 'Near upper band with RSI near threshold';
        } else if (nearLower && rsi < config.rsiOversoldThreshold + 5) {
            type = 'SELL';
            reason = 'Near lower band with RSI near threshold';
        }
    }

    let breakoutFactor = 0, rsiFactor = 0, macdFactor = 0;

    if (type !== 'HOLD') {
        if (type === 'BUY') {
            const breakoutPct = ((currentPrice - upper) / upper) * 100;
            breakoutFactor = Math.min(Math.max(breakoutPct * 5, 0), 60);

            const rsiOver = Math.max(rsi - config.rsiOverboughtThreshold, 0);
            rsiFactor = Math.min((rsiOver / 10) * 20, 20);

            macdFactor = Math.min(Math.abs(macd), 5) / 5 * 20;
        } else if (type === 'SELL') {
            const breakoutPct = ((lower - currentPrice) / lower) * 100;
            breakoutFactor = Math.min(Math.max(breakoutPct * 5, 0), 60);

            const rsiUnder = Math.max(config.rsiOversoldThreshold - rsi, 0);
            rsiFactor = Math.min((rsiUnder / 10) * 20, 20);

            macdFactor = Math.min(Math.abs(macd), 5) / 5 * 20;
        }
    }

    const strength = Math.min(breakoutFactor + rsiFactor + macdFactor, 100);

    const output = `[Signal] ${asset} | Breakout | Type=${type} | Price=${currentPrice.toFixed(2)} | BB:[${lower.toFixed(2)}-${upper.toFixed(2)}] | RSI=${rsi.toFixed(1)} | MACD=${macd.toFixed(2)} | Strength=${strength.toFixed(1)} | Reason=${reason}`;

    if (type === 'HOLD') logDebug(output);
    else logInfo(output);

    return { type, strength, reason };
};
