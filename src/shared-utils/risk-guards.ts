// ✅ File: risk/check-risk-guards.ts (Refined Balance Check and Risk Logging)
import { logInfo } from './logger.js';
import type { Hyperliquid } from '../sdk/index.js';
import { stateManager } from './state-manager.js';
import type { CoinMeta } from './coin-meta.js';
import { hasMinimumBalance, MIN_BALANCE_USD } from './check-balance.js';

const MAX_DAILY_LOSS_USD = 200;
const MIN_NOTIONAL_USD = 10;

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

    const { coin, dayNtlVlm, minVlmUsd, szDecimals } = coinMeta;

    const balanceOk = await hasMinimumBalance(hyperliquid, subaccountAddress);
    if (!balanceOk) {
        logInfo(`[RiskGuard] ❌ Insufficient balance → withdrawable below $${MIN_BALANCE_USD}. Exits only.`);
        return { canTrade: false, qty };
    }

    const todayLoss = stateManager.getDailyLossUsd();
    if (todayLoss >= MAX_DAILY_LOSS_USD) {
        logInfo(`[RiskGuard] ❌ Daily loss limit reached → $${todayLoss.toFixed(2)} / $${MAX_DAILY_LOSS_USD}. Shutting down bot.`);
        process.exit(1);
    }

    if (isNaN(dayNtlVlm) || dayNtlVlm < minVlmUsd) {
        logInfo(`[RiskGuard] ❌ ${coin} skipped → Daily vol $${dayNtlVlm.toLocaleString()} < min $${minVlmUsd.toLocaleString()}`);
        return { canTrade: false, qty };
    }

    const notional = qty * px;
    if (notional < MIN_NOTIONAL_USD) {
        const bumpFactor = MIN_NOTIONAL_USD / Math.max(notional, 1e-6);
        const bumpedQty = Number((qty * bumpFactor).toFixed(szDecimals));
        const bumpedNotional = bumpedQty * px;
        logInfo(`[RiskGuard] ⚠️ Notional $${notional.toFixed(2)} < $${MIN_NOTIONAL_USD} → bump qty ${qty} → ${bumpedQty} ($${bumpedNotional.toFixed(2)})`);
        return { canTrade: true, qty: bumpedQty };
    }

    const tidyQty = Number(qty.toFixed(szDecimals));
    return { canTrade: true, qty: tidyQty };
};
