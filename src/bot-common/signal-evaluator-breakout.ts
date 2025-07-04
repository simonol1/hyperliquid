// src/bot-common/signal-evaluator-breakout.ts

import { logInfo } from './utils/logger.js';
import type { Analysis } from './analyse-asset.js';

export interface Signal {
    type: 'BUY' | 'SELL' | 'HOLD';
    strength: number;
}

export const evaluateSignalBreakout = (
    asset: string,
    assetData: Analysis,
    config: any
): Signal => {
    const {
        currentPrice,
        bollingerBands: { upper, lower },
        rsi,
    } = assetData;

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    // Example: breakout above upper band → BUY
    if (currentPrice > upper && rsi > 50) {
        type = 'BUY';
    }
    // Example: breakdown below lower band → SELL
    else if (currentPrice < lower && rsi < 50) {
        type = 'SELL';
    }

    const distance = type === 'BUY'
        ? Math.abs(currentPrice - upper)
        : type === 'SELL'
            ? Math.abs(currentPrice - lower)
            : 0;

    const strength = type === 'HOLD'
        ? 0
        : Math.max(1, 100 - distance); // closer to band = stronger

    logInfo(
        `[Breakout Evaluator] ${asset} | Type=${type} | Px=${currentPrice.toFixed(2)} | Bands=[${lower.toFixed(2)}-${upper.toFixed(2)}] | RSI=${rsi.toFixed(1)} | Strength=${strength.toFixed(1)}`
    );

    return { type, strength };
};
