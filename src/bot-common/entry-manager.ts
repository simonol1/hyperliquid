// src/bot-common/entry-manager.ts
import { stateManager } from './state-manager.js';
import { mapRisk } from './utils/risk-mapper.js';
import { logInfo } from './utils/logger.js';
import { executeEntry } from './trade-executor.js';
import type { Signal } from './signal-evaluator-trend.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const handleEntry = async ({
    hyperliquid,
    coin,
    signal,
    analysis,
    config,
    totalAccountUsd,
    pairMaxLeverage,
}: {
    hyperliquid: Hyperliquid;
    coin: string;
    signal: Signal;
    analysis: any;
    config: BotConfig;
    totalAccountUsd: number;
    pairMaxLeverage: number;
}) => {
    logInfo(`[EntryManager] Signal: ${JSON.stringify(signal)}`);

    if (signal.strength < config.riskMapping.minScore) {
        logInfo(`[EntryManager] Signal too weak (${signal.strength}), skipping.`);
        return;
    }

    if (stateManager.isInCooldown(coin)) {
        logInfo(`[EntryManager] ${coin} is cooling down — skipping.`);
        return;
    }

    if (stateManager.getActivePosition(coin)) {
        logInfo(`[EntryManager] Already have position for ${coin} — skipping.`);
        return;
    }

    const { positionPct, leverage } = mapRisk(
        signal.strength,
        config.riskMapping.minScore,
        config.riskMapping.goldenScore,
        config.riskMapping.minCapitalRiskPct,
        config.riskMapping.maxCapitalRiskPct,
        config.riskMapping.minLeverage,
        config.riskMapping.maxLeverage
    );

    const finalPositionUsd = positionPct * totalAccountUsd;
    const safeLeverage = Math.min(leverage, pairMaxLeverage);

    if (signal.type === 'HOLD') {
        logInfo(`[EntryManager] Signal is HOLD, skipping.`);
        return;
    }

    await executeEntry(
        hyperliquid,
        coin,
        analysis.currentPrice,
        finalPositionUsd,
        safeLeverage,
        signal.type
    );

    stateManager.setActivePosition(coin, {
        qty: finalPositionUsd / analysis.currentPrice,
        entryPrice: analysis.currentPrice,
        isShort: signal.type === 'SELL',
    });

    logInfo(`[EntryManager] Position opened: ${coin} USD ${finalPositionUsd.toFixed(2)} Leverage ${safeLeverage}x`);
};
