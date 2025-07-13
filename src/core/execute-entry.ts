import { logInfo } from '../shared-utils/logger.js';
import { placeOrderSafe } from '../orders/place-order-safe.js';
import { placeStopLoss } from '../orders/place-stop-loss.js';
import { placeTakeProfit } from '../orders/place-take-profit.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { TradeSignal } from '../shared-utils/types.js';
import type { CoinMeta } from '../shared-utils/coin-meta.js';
import type { BotConfig } from '../bots/config/bot-config.js';
import type { PositionSizingResult } from '../shared-utils/position-size.js';
import { checkRiskGuards } from '../shared-utils/risk-guards.js';

export const executeEntry = async (
    hyperliquid: Hyperliquid,
    signal: TradeSignal,
    config: BotConfig,
    coinMeta: CoinMeta,
    risk: PositionSizingResult,
) => {
    const { coin, pxDecimals, szDecimals } = coinMeta;
    const rawQty = (risk.capitalRiskUsd * risk.leverage) / signal.entryPrice;

    const { canTrade, qty: safeQty } = await checkRiskGuards(
        hyperliquid,
        config.subaccountAddress,
        rawQty,
        signal.entryPrice,
        coinMeta
    );

    if (!canTrade) return;

    const tidyQty = Number(safeQty.toFixed(szDecimals));
    const ok = await placeOrderSafe(
        hyperliquid,
        coin,
        signal.side === 'LONG',
        tidyQty,
        false,
        'Ioc',
        config.subaccountAddress,
        pxDecimals
    );

    if (ok) {
        logInfo(`[ExecuteEntry] ✅ Placed ${coin} qty=${tidyQty}`);
        await placeStopLoss(
            hyperliquid,
            coin,
            signal.side === 'LONG',
            tidyQty,
            signal.entryPrice,
            config.stopLossPct,
            config.subaccountAddress,
            pxDecimals
        );
        await placeTakeProfit(
            hyperliquid,
            coin,
            signal.side === 'LONG',
            tidyQty,
            signal.entryPrice,
            config.initialTakeProfitPct,
            config.subaccountAddress,
            pxDecimals
        );
    }
};
