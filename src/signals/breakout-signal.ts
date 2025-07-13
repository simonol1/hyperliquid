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

    // --- New weighted factors ---
    let breakoutFactor = 0;
    let rsiFactor = 0;
    let macdFactor = 0;

    if (type === 'BUY') {
        const breakoutPct = ((currentPrice - upper) / upper) * 100;
        breakoutFactor = Math.min(Math.max(breakoutPct * 4, 0), 60); // ⚡ heavier weight

        const rsiOver = Math.max(rsi - config.rsiOverboughtThreshold, 0);
        rsiFactor = Math.min((rsiOver / 10) * 20, 20); // 🟡 lower weight

        macdFactor = Math.min(Math.abs(macd), 5) / 5 * 20;
    } else if (type === 'SELL') {
        const breakoutPct = ((lower - currentPrice) / lower) * 100;
        breakoutFactor = Math.min(Math.max(breakoutPct * 4, 0), 60); // ⚡ heavier weight

        const rsiUnder = Math.max(config.rsiOversoldThreshold - rsi, 0);
        rsiFactor = Math.min((rsiUnder / 10) * 20, 20); // 🟡 lower weight

        macdFactor = Math.min(Math.abs(macd), 5) / 5 * 20;
    }

    const strength = Math.min(breakoutFactor + rsiFactor + macdFactor, 100);

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
