import { logInfo, logError } from '../shared-utils/logger.js';
import { executeEntry } from '../core/execute-entry.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { CoinMeta } from '../shared-utils/coin-meta.js';
import { TradeSignal } from '../shared-utils/types.js';
import { PositionSizingResult } from '../shared-utils/position-size.js';
import type { BotConfig } from '../bots/config/bot-config.js';

export const orchestrateEntry = async (
    hyperliquid: Hyperliquid,
    signal: TradeSignal,
    risk: PositionSizingResult,
    config: BotConfig,
    coinMeta: CoinMeta
) => {

    logInfo(`[Orchestrator] ➜ ${signal.coin} | USD=$${risk.capitalRiskUsd.toFixed(2)} | Lev=${risk.leverage.toFixed(1)}x | ${signal.side} | Strength=${signal.strength.toFixed(1)}`);

    if (!coinMeta) {
        logError(`[Orchestrator] ❌ No coin meta for ${signal.coin}`);
        return;
    }

    await executeEntry(hyperliquid, signal, config, coinMeta, risk);
};
