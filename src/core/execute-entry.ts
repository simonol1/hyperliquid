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
import { setTrackedPosition } from '../shared-utils/tracked-position.js';

export const executeEntry = async (
    hyperliquid: Hyperliquid,
    signal: TradeSignal,
    config: BotConfig,
    coinMeta: CoinMeta,
    risk: PositionSizingResult,
) => {
    const { coin, pxDecimals, szDecimals } = coinMeta;
    const rawQty = (risk.capitalRiskUsd * risk.leverage) / signal.entryPrice;

    const isLong = signal.side === "LONG"

    const { canTrade, qty: safeQty } = await checkRiskGuards(
        hyperliquid,
        config.subaccountAddress,
        rawQty,
        signal.entryPrice,
        coinMeta
    );

    if (!canTrade) return;

    const tidyQty = Number(safeQty.toFixed(szDecimals));

    await hyperliquid.exchange.updateLeverage(
        coin,
        'isolated',
        risk.leverage
    );

    const ok = await placeOrderSafe(
        hyperliquid,
        coin,
        isLong,
        tidyQty,
        false,
        'Ioc',
        config.subaccountAddress,
        pxDecimals
    );

    if (ok) {
        const { atr, entryPrice, strength } = signal

        // --- Dynamic SL based on ATR ---
        const atrPct = atr ? (atr / entryPrice) * 100 : config.stopLossPct;
        const dynamicSL = Math.max(atrPct * 1.2, config.stopLossPct); // safe floor

        // --- Dynamic TP based on Signal Strength ---
        const rrMultiplier = Math.min(2.0, 1 + (strength - config.riskMapping.minScore) / 50); // 1.0 to 2.0
        const dynamicTP = dynamicSL * rrMultiplier;

        const takeProfitTarget = isLong
            ? entryPrice * (1 + dynamicTP / 100)
            : entryPrice * (1 - dynamicTP / 100);

        const trailingStopTarget = isLong
            ? entryPrice * (1 - config.trailingStopPct / 100)
            : entryPrice * (1 + config.trailingStopPct / 100);

        await setTrackedPosition(coin, {
            qty: tidyQty,
            leverage: risk.leverage,
            entryPrice,
            isLong: signal.side === 'LONG',
            takeProfitTarget,
            trailingStopTarget,
            highestPrice: entryPrice,
            openedAt: Date.now(),
        });

        logInfo(`[ExecuteEntry] ✅ Placed ${coin} qty=${tidyQty}`);

        await placeStopLoss(
            hyperliquid,
            coin,
            isLong,
            tidyQty,
            entryPrice,
            dynamicSL,
            config.subaccountAddress,
            pxDecimals
        );
        await placeTakeProfit(
            hyperliquid,
            coin,
            isLong,
            tidyQty,
            entryPrice,
            dynamicTP,
            config.subaccountAddress,
            pxDecimals
        );
    }
};
