import { stateManager } from './state-manager.js';
import { calculatePositionSize } from './utils/risk-mapper.js';
import { logInfo } from './utils/logger.js';
import { executeEntry } from './trade-executor.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { Signal } from './utils/types.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const handleSignal = async (
    hyperliquid: Hyperliquid,
    coin: string,
    signal: Signal,
    analysis: any,
    config: BotConfig,
    maxLeverageMap: Record<string, number>
) => {
    logInfo(`[handleSignal] Signal: ${JSON.stringify(signal)}`);

    if (signal.strength < config.riskMapping.minScore) {
        logInfo(`[handleSignal] Signal too weak (${signal.strength}), skipping.`);
        return;
    }

    if (stateManager.isInCooldown(coin)) {
        logInfo(`[handleSignal] ${coin} is cooling down — skipping.`);
        return;
    }

    if (stateManager.getActivePosition(coin)) {
        logInfo(`[handleSignal] Already have position for ${coin} — skipping.`);
        return;
    }

    if (signal.type === 'HOLD') {
        logInfo(`[handleSignal] Signal is HOLD, skipping.`);
        return;
    }

    const { capitalRiskUsd, leverage: mappedLeverage } = calculatePositionSize(
        signal.strength,
        config.maxCapitalRiskUsd,
        config.riskMapping
    );

    const pairMaxLeverage = maxLeverageMap[coin] ?? config.leverage;
    const leverage = Math.min(mappedLeverage, pairMaxLeverage);

    logInfo(
        `[handleSignal] Final risk mapped → USD: ${capitalRiskUsd.toFixed(
            2
        )}, leverage: ${leverage.toFixed(2)}x (capped by pair max)`
    );

    await executeEntry(
        hyperliquid,
        config.walletAddress,
        coin,
        analysis.currentPrice,
        capitalRiskUsd,
        leverage,
        signal.type,
        config.strategy as "breakout" | "trend" | "reversion"
    );

    stateManager.setActivePosition(coin, {
        qty: capitalRiskUsd / analysis.currentPrice,
        entryPrice: analysis.currentPrice,
        isShort: signal.type === 'SELL',
    });

    logInfo(`[handleSignal] Position opened: ${coin} USD ${capitalRiskUsd.toFixed(2)} Leverage ${leverage}x`);
};
