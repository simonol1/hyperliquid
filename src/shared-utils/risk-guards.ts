import { logInfo } from './logger.js';
import type { Hyperliquid } from '../sdk/index.js';
import { stateManager } from './state-manager.js';
import type { CoinMeta } from './coin-meta.js';
import { hasMinimumBalance } from './check-balance.js';

const MIN_BALANCE_USD = 11;
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
    vaultAddress: string,
    qty: number,
    px: number,
    coinMeta?: CoinMeta
): Promise<{ canTrade: boolean; qty: number }> => {

    if (!coinMeta) {
        logInfo(`[RiskGuard] ❌ No meta found for coin. Skipping trade.`);
        return { canTrade: false, qty };
    }

    const { coin, dayNtlVlm, minVlmUsd, szDecimals } = coinMeta;

    const balanceOk = hasMinimumBalance(hyperliquid, vaultAddress, MIN_BALANCE_USD)
    if (!balanceOk) {
        logInfo(`[RiskGuard] ⚠️ Balance too low for new trades. Will only run exits.`);
        return { canTrade: false, qty };
    }

    // === 2️⃣ Daily PnL check ===
    const todayLoss = stateManager.getDailyLossUsd();
    if (todayLoss >= MAX_DAILY_LOSS_USD) {
        logInfo(`[RiskGuard] ❌ Daily loss limit hit: $${todayLoss.toFixed(2)} ≥ $${MAX_DAILY_LOSS_USD}. Stopping bot.`);
        process.exit(1);
    }

    // === 3️⃣ Daily volume guard ===
    if (isNaN(dayNtlVlm) || dayNtlVlm < minVlmUsd) {
        logInfo(`[RiskGuard] ❌ ${coin} skipped — daily vol $${dayNtlVlm.toLocaleString()} < min $${minVlmUsd.toLocaleString()}`);
        return { canTrade: false, qty };
    }

    // === 4️⃣ Notional check ===
    const notional = qty * px;
    if (notional < MIN_NOTIONAL_USD) {
        const bumpFactor = MIN_NOTIONAL_USD / Math.max(notional, 1e-6); // Prevent div by 0
        const bumpedQty = Number((qty * bumpFactor).toFixed(szDecimals));
        const bumpedNotional = bumpedQty * px;

        logInfo(`[RiskGuard] ⚠️ Notional $${notional.toFixed(2)} < $${MIN_NOTIONAL_USD} → bumping qty to ${bumpedQty} ($${bumpedNotional.toFixed(2)})`);
        return { canTrade: true, qty: bumpedQty };
    }

    // === 5️⃣ Final tidy ===
    const tidyQty = Number(qty.toFixed(szDecimals));
    return { canTrade: true, qty: tidyQty };
};
