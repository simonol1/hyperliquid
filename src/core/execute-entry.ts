import { logInfo } from '../shared-utils/logger.js';
import { placeOrderSafe } from '../orders/place-order-safe.js';
import { placeStopLoss } from '../orders/place-stop-loss.js';
import { placeTakeProfits } from '../orders/place-take-profit.js';
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

    const isLong = signal.side === 'LONG';

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

    if (!ok) return;

    const { atr, entryPrice, strength } = signal;

    // --- Stop Loss ---
    const atrPct = atr ? (atr / entryPrice) * 100 : config.stopLossPct;
    const stopLossPct = Math.max(atrPct * 1.2, config.stopLossPct);

    // --- Trailing Stop ---
    const trailingStopTarget = isLong
        ? entryPrice * (1 - config.trailingStopPct / 100)
        : entryPrice * (1 + config.trailingStopPct / 100);

    // --- Take Profit Levels ---
    const tpPercents = config.takeProfitPercents || [2, 4, 6];
    const runnerPct = config.runnerPct

    await placeStopLoss(
        hyperliquid,
        coin,
        isLong,
        tidyQty,
        entryPrice,
        stopLossPct,
        pxDecimals
    );

    await placeTakeProfits(
        hyperliquid,
        coin,
        isLong,
        tidyQty,
        entryPrice,
        tpPercents,
        runnerPct,
        pxDecimals
    );

    await setTrackedPosition(coin, {
        qty: tidyQty,
        leverage: risk.leverage,
        entryPrice,
        isLong,
        takeProfitLevels: tpPercents,
        takeProfitHit: [],
        breakevenTriggered: false,
        takeProfitTarget: isLong
            ? entryPrice * (1 + tpPercents[tpPercents.length - 1] / 100)
            : entryPrice * (1 - tpPercents[tpPercents.length - 1] / 100),
        trailingStopTarget,
        trailingStopActive: true,
        trailingStopPct: config.trailingStopPct,
        highestPrice: entryPrice,
        openedAt: Date.now(),
    });

    logInfo(`[ExecuteEntry] ✅ Placed ${coin} qty=${tidyQty}`);
};
