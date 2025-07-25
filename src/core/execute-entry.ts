import { logInfo, logWarn } from '../shared-utils/logger.js';
import { placeOrderSafe } from '../orders/place-order-safe.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { TradeSignal } from '../shared-utils/types.js';
import type { CoinMeta } from '../shared-utils/coin-meta.js';
import type { BotConfig } from '../bots/config/bot-config.js';
import type { PositionSizingResult } from '../shared-utils/position-size.js';
import { checkRiskGuards } from '../shared-utils/risk-guards.js';
import { setTrackedPosition } from '../shared-utils/tracked-position.js';
import { redis } from '../shared-utils/redis-client.js';

export const executeEntry = async (
    hyperliquid: Hyperliquid,
    signal: TradeSignal,
    config: BotConfig,
    coinMeta: CoinMeta,
    risk: PositionSizingResult,
) => {
    const { coin, pxDecimals, szDecimals, minSize } = coinMeta; // Destructure minSize from coinMeta
    const rawQty = (risk.capitalRiskUsd * risk.leverage) / signal.entryPrice;

    // Pre-check minSize before calling checkRiskGuards to prevent tiny orders
    if (rawQty < minSize) {
        logWarn(`[ExecuteEntry] ⚠️ Initial calculated quantity (${rawQty.toFixed(szDecimals)}) for ${coin} is below minSize (${minSize}). Skipping entry.`);
        return; // Do not proceed with the trade
    }

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

    const { success } = await placeOrderSafe(
        hyperliquid,
        coin,
        isLong,
        tidyQty,
        false,
        'Ioc',
        config.subaccountAddress,
        pxDecimals
    );

    if (!success) return;

    const { entryPrice } = signal; // atr and strength are not needed for exit order queueing

    // Define TP percentages from config
    const tpPercents = config.takeProfitPercents

    // Define runner and stop loss percentages from config
    const runnerPercent = config.runnerPct;
    const stopLossPercent = config.stopLossPct;

    // Queue SL and TP orders to ensure that order is filled to avoid rejection
    // FIX: Ensure totalQty, szDecimals, and runnerPercent are correctly passed to Redis
    await redis.set(`pendingExitOrders:${coin}`, JSON.stringify({
        coin,
        isLong,
        totalQty: tidyQty,
        entryPx: entryPrice,
        pxDecimals,
        szDecimals, // Added: Pass szDecimals to the worker
        tpPercents,
        runnerPercent,
        stopLossPercent,
        ts: Date.now(),
        tp1: { price: 0, qty: 0, placed: false },
        tp2: { price: 0, qty: 0, placed: false },
        tp3: { price: 0, qty: 0, placed: false },
        runner: { price: 0, qty: 0, placed: false },
        sl: { price: 0, qty: 0, placed: false },
    }), { EX: 90 }); // Expires in 90 seconds if not processed

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
        trailingStopTarget: isLong
            ? entryPrice * (1 - config.trailingStopPct / 100)
            : entryPrice * (1 + config.trailingStopPct / 100),
        trailingStopActive: true,
        trailingStopPct: config.trailingStopPct,
        highestPrice: entryPrice,
        openedAt: Date.now(),
    });

    logInfo(`[ExecuteEntry] ✅ Placed ${coin} qty=${tidyQty}`);
};
