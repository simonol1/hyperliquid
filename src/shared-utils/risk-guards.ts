// ✅ File: risk/check-risk-guards.ts (Refined Balance Check and Risk Logging)
import { logInfo, logWarn } from '../shared-utils/logger.js'; // Ensure logWarn is imported
import type { Hyperliquid } from '../sdk/index.js';
import { stateManager } from './state-manager.js';
import type { CoinMeta } from './coin-meta.js';
import { hasMinimumBalance, MIN_BALANCE_USD } from './check-balance.js';

const MAX_DAILY_LOSS_USD = 200;
const MIN_NOTIONAL_USD = 30;

/**
 * Run all risk guards:
 * - Checks wallet balance
 * - Enforces daily loss limit
 * - Validates daily volume against minimum
 * - Enforces minimum notional value
 */
export const checkRiskGuards = async (
    hyperliquid: Hyperliquid,
    subaccountAddress: string,
    qty: number,
    px: number,
    coinMeta?: CoinMeta
): Promise<{ canTrade: boolean; qty: number }> => {

    if (!coinMeta) {
        logInfo(`[RiskGuard] ❌ No meta found for coin → skipping.`);
        return { canTrade: false, qty };
    }

    const { coin, dayNtlVlm, minVlmUsd, szDecimals, minSize } = coinMeta; // Destructure minSize

    // --- 1. Check Wallet Balance ---
    const balanceOk = await hasMinimumBalance(hyperliquid, subaccountAddress);
    if (!balanceOk) {
        logInfo(`[RiskGuard] ❌ Insufficient balance → withdrawable below $${MIN_BALANCE_USD}. Exits only.`);
        return { canTrade: false, qty };
    }

    // --- 2. Enforce Daily Loss Limit ---
    const todayLoss = stateManager.getDailyLossUsd();
    if (todayLoss >= MAX_DAILY_LOSS_USD) {
        logWarn(`[RiskGuard] ❌ Daily loss limit reached → $${todayLoss.toFixed(2)} / $${MAX_DAILY_LOSS_USD}. Shutting down bot.`);
        // Consider whether to process.exit(1) here or just return false
        // For a worker, returning false might be better to allow other workers to run.
        // If it's a critical bot, exit might be desired. Keeping exit for now as per original.
        process.exit(1);
    }

    // --- 3. Validate Daily Volume ---
    if (isNaN(dayNtlVlm) || dayNtlVlm < minVlmUsd) {
        logInfo(`[RiskGuard] ❌ ${coin} skipped → Daily vol $${dayNtlVlm.toLocaleString()} < min $${minVlmUsd.toLocaleString()}`);
        return { canTrade: false, qty };
    }

    // --- 4. Enforce Minimum Notional Value ---
    const notional = qty * px;
    if (notional < MIN_NOTIONAL_USD) {
        // FIX: Prevent trade if notional is below MIN_NOTIONAL_USD
        logInfo(`[RiskGuard] ❌ Notional $${notional.toFixed(2)} < $${MIN_NOTIONAL_USD} for ${coin}. Skipping trade.`);
        return { canTrade: false, qty: 0 }; // Return canTrade: false and 0 qty
    }

    // --- 5. Enforce Minimum Quantity Size (from coinMeta) ---
    // This check was previously suggested to be in executeEntry or here.
    // Placing it here ensures any quantity passed down is valid.
    if (qty < minSize) {
        logInfo(`[RiskGuard] ❌ Calculated quantity (${qty.toFixed(szDecimals)}) for ${coin} is below minSize (${minSize}). Skipping trade.`);
        return { canTrade: false, qty: 0 };
    }

    // Ensure quantity is rounded to szDecimals before returning
    const tidyQty = Number(qty.toFixed(szDecimals));
    return { canTrade: true, qty: tidyQty };
};
