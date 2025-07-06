import { logInfo } from './logger.js';
import type { Hyperliquid } from '../../sdk/index.js';
import { stateManager } from '../state-manager.js';

const MIN_BALANCE_USD = 50;       // Minimum wallet balance required to trade
const MAX_DAILY_LOSS_USD = 50;    // Maximum daily loss before stopping

export const checkRiskGuards = async (hyperliquid: Hyperliquid, walletAddress: string): Promise<boolean> => {
    // === 1️⃣ Get perpetuals margin state ===
    const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(walletAddress);
    const availableUsd = Number(perpState.withdrawable) || 0;

    if (availableUsd < MIN_BALANCE_USD) {
        logInfo(`[RiskGuard] ❌ Balance too low: $${availableUsd.toFixed(2)} < $${MIN_BALANCE_USD}. Skipping trade.`);
        return false;
    }

    // === 2️⃣ Check daily PnL ===
    const todayLoss = stateManager.getDailyLossUsd();

    if (todayLoss >= MAX_DAILY_LOSS_USD) {
        logInfo(`[RiskGuard] ❌ Daily loss limit hit: $${todayLoss.toFixed(2)} ≥ $${MAX_DAILY_LOSS_USD}. Stopping bot.`);
        process.exit(1);
    }

    return true;
};
