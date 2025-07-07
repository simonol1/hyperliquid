import { stateManager } from './state-manager.js';
import { calculatePositionSize } from './utils/risk-mapper.js';
import { logError, logInfo } from './utils/logger.js';
import { executeEntry } from './trade-executor.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { Signal } from './utils/types.js';
import type { BotConfig } from '../bots/config/bot-config.js';
import { CoinMeta } from './utils/coin-meta.js';

export const handleSignal = async (
    hyperliquid: Hyperliquid,
    signal: Signal,
    analysis: any,
    config: BotConfig,
    coinMeta?: CoinMeta
) => {

    const { coin, maxLeverage } = coinMeta || {}

    if (!coinMeta || !coin) {
        logError(`[handleSignal] No coin metadata found for ${coin}, using default config.`);
        return;
    }

    logInfo(`[handleSignal] Signal: ${JSON.stringify(signal)}`);

    if (signal.strength < config.riskMapping.minScore) {
        logInfo(`[handleSignal] Signal too weak (${signal.strength}), skipping.`);
        return;
    }

    if (stateManager.isInCooldown(coin)) {
        logInfo(`[handleSignal] ${coin} is cooling down — skipping.`);
        return;
    }

    // ✅ Check *real* clearinghouse position
    const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(config.vaultAddress);
    const realPosition = perpState.assetPositions.find(
        (p) => p.position.coin === coin && Math.abs(parseFloat(p.position.szi)) > 0
    );

    if (realPosition) {
        logInfo(`[handleSignal] Already have real position for ${coin} — skipping.`);
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

    const pairMaxLeverage = maxLeverage ?? config.leverage;
    const leverage = Math.min(mappedLeverage, pairMaxLeverage);

    logInfo(
        `[handleSignal] Final risk mapped → USD: ${capitalRiskUsd.toFixed(
            2
        )}, leverage: ${leverage.toFixed(2)}x (capped by pair max)`
    );

    await executeEntry(
        hyperliquid,
        config.vaultAddress,
        analysis.currentPrice,
        capitalRiskUsd,
        leverage,
        signal.type,
        config.strategy as "breakout" | "trend" | "reversion",
        signal.strength,
        coinMeta
    );
};

