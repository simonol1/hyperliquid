// src/bot-common/signal-evaluator-reversion.ts

import { logInfo } from './utils/logger.js';
import type { Analysis } from './analyse-asset.js';

export interface Signal {
    type: 'BUY' | 'SELL' | 'HOLD';
    strength: number;
}

export const evaluateSignalReversion = (
    asset: string,
    assetData: Analysis,
    config: any
): Signal => {
    const {
        currentPrice,
        fastEma,
        slowEma,
        bollingerBands: { upper, lower },
        rsi,
    } = assetData;

    let type: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    const emaSpread = fastEma - slowEma;

    if (currentPrice < lower && rsi < (config.rsiOversoldThreshold ?? 30) && emaSpread < 0) {
        type = 'BUY'; // mean reversion up
    } else if (currentPrice > upper && rsi > (config.rsiOverboughtThreshold ?? 70) && emaSpread > 0) {
        type = 'SELL'; // mean reversion down
    }

    const distance = type === 'BUY'
        ? Math.abs(currentPrice - lower)
        : type === 'SELL'
            ? Math.abs(currentPrice - upper)
            : 0;

    const strength = type === 'HOLD'
        ? 0
        : distance * 0.5 + Math.abs(rsi - 50); // further from band + RSI = stronger

    logInfo(
        `[Reversion Evaluator] ${asset} | Type=${type} | Px=${currentPrice.toFixed(2)} | Bands=[${lower.toFixed(2)}-${upper.toFixed(2)}] | EMA Spread=${emaSpread.toFixed(2)} | RSI=${rsi.toFixed(1)} | Strength=${strength.toFixed(1)}`
    );

    return { type, strength };
};
