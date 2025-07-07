import { logInfo, logError, logExit } from './utils/logger.js';
import { stateManager } from './state-manager.js';
import type { Hyperliquid } from '../sdk/index.js';
import { checkRiskGuards } from './utils/risk-guards.js';
import { checkTrailingStop, checkTakeProfit } from './utils/trailing-stop-helpers.js';
import type { CoinMeta } from './utils/coin-meta.js';
import type { Analysis } from './analyse-asset.js';
import type { BotConfig } from '../bots/config/bot-config.js';

// === TYPES ===

export interface ExitIntent {
  quantity: number;
  price: number;
  type: 'SELL' | 'CLOSE' | 'EXIT';
  reason: string;
}

export interface Position {
  qty: number;
  entryPrice: number;
  highestPrice: number;
  isShort: boolean;
  takeProfitTarget?: number;
}

const DEFAULT_MAX_SLIPPAGE_PCT = 0.002;

// === SAFE ORDER ===

export const placeOrderSafe = async (
  hyperliquid: Hyperliquid,
  coin: string,
  isBuy: boolean,
  size: number,
  rawPx: number,
  reduceOnly = false,
  tif: 'Ioc' | 'Gtc' = 'Ioc',
  vaultAddress: string,
  pxDecimals: number
) => {
  if (pxDecimals < 0 || pxDecimals > 10) {
    throw new Error(`[placeOrderSafe] ❌ Invalid pxDecimals: ${pxDecimals}`);
  }

  const tickSize = 1 / Math.pow(10, pxDecimals);
  let px = Math.round(rawPx / tickSize) * tickSize;

  logInfo(`[Placing] ${coin} ${isBuy ? 'BUY' : 'SELL'} qty=${size} px=${px} tickSize=${tickSize}`);

  const res = await hyperliquid.exchange.placeOrder({
    coin,
    is_buy: isBuy,
    sz: size,
    limit_px: px.toFixed(pxDecimals),
    order_type: { limit: { tif } },
    reduce_only: reduceOnly,
    vaultAddress,
  });

  if (res.status === 'ok') {
    const statuses = res.response?.data?.statuses;
    if (statuses && statuses[0] && statuses[0].status !== 'error') {
      logInfo(`[Placing] ✅ Accepted @ ${px}`);
      return true;
    }
  }

  // If rejected → nudge 1 tick
  px += isBuy ? tickSize : -tickSize;
  px = Math.round(px / tickSize) * tickSize;

  logInfo(`[Placing] Retry @ ${px}`);

  const retry = await hyperliquid.exchange.placeOrder({
    coin,
    is_buy: isBuy,
    sz: size,
    limit_px: px.toFixed(pxDecimals),
    order_type: { limit: { tif } },
    reduce_only: reduceOnly,
    vaultAddress,
  });

  if (retry.status === 'ok') {
    const statuses = retry.response?.data?.statuses;
    if (statuses && statuses[0] && statuses[0].status !== 'error') {
      logInfo(`[Placing] ✅ Retry accepted @ ${px}`);
      return true;
    }
  }

  logError(`[Placing] ❌ Still invalid after retry @ ${px}`);
  return false;
};

// === ENTRY ===

export const executeEntry = async (
  hyperliquid: Hyperliquid,
  vaultAddress: string,
  entryPrice: number,
  capitalRiskUsd: number,
  leverage: number,
  side: 'BUY' | 'SELL',
  strategy: 'breakout' | 'trend' | 'reversion',
  signalStrength: number,
  coinMeta?: CoinMeta
) => {
  if (!coinMeta) {
    logError(`[TradeExecutor] ❌ No coin metadata found for entry`);
    return;
  }

  const coin = coinMeta.coin;
  const positionValueUsd = capitalRiskUsd * leverage;
  const rawQty = positionValueUsd / entryPrice;

  const { canTrade, qty: safeQty } = await checkRiskGuards(
    hyperliquid,
    vaultAddress,
    rawQty,
    entryPrice,
    coinMeta
  );

  if (!canTrade) {
    logInfo(`[TradeExecutor] Risk guards blocked → ${coin}`);
    return;
  }

  const tidyQty = Number(safeQty.toFixed(coinMeta.szDecimals));
  const pxDecimals = coinMeta.pxDecimals ?? 2;

  const tidyLeverage = Math.round(leverage * 10) / 10;
  const tidyStrength = Math.round(signalStrength * 10) / 10;

  logInfo(`[TradeExecutor] FINAL ENTRY → ${coin} ${side} qty=${tidyQty} @ ${entryPrice} lev=${tidyLeverage}x strength=${tidyStrength}`);

  if (process.env.DRY_RUN === 'true') {
    logInfo(`[DryRun] Would place ${strategy.toUpperCase()} → ${coin} ${side} qty=${tidyQty}`);
    return;
  }

  const px = side === 'BUY'
    ? entryPrice * (1 + DEFAULT_MAX_SLIPPAGE_PCT)
    : entryPrice * (1 - DEFAULT_MAX_SLIPPAGE_PCT);

  const tidyPx = Number(px.toFixed(pxDecimals));

  const ok = await placeOrderSafe(
    hyperliquid,
    coin,
    side === 'BUY',
    tidyQty,
    tidyPx,
    false,
    strategy === 'reversion' ? 'Gtc' : 'Ioc',
    vaultAddress,
    pxDecimals // ✅ FIXED: pass decimals, not px
  );

  if (ok) {
    logInfo(`[TradeExecutor] ✅ Position opened: ${coin} USD ${capitalRiskUsd} Lev ${tidyLeverage}x`);
  } else {
    logError(`[TradeExecutor] ❌ Entry failed: ${coin}`);
  }
};

// === EVALUATE EXIT ===

export const evaluateExit = (
  position: Position,
  analysis: Analysis,
  config: BotConfig
): ExitIntent | null => {
  const shouldExit =
    checkTrailingStop(position, analysis, config) ||
    checkTakeProfit(position, analysis, config);

  if (!shouldExit) return null;

  return {
    quantity: position.qty,
    price: analysis.currentPrice,
    type: 'EXIT',
    reason: 'TrailingStopOrTP',
  };
};

// === EXECUTE EXIT ===

export const executeExit = async (
  hyperliquid: Hyperliquid,
  vaultAddress: string,
  exitIntent: ExitIntent,
  coinMeta?: CoinMeta
) => {
  if (!coinMeta) {
    logError(`[executeExit] ❌ No coin metadata found for exit intent`);
    return;
  }

  const coin = coinMeta.coin;

  logInfo(`[executeExit] Processing exit for ${coin} at price ${exitIntent.price} reason=${exitIntent.reason}`);

  const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(vaultAddress);
  const realPosition = perpState.assetPositions.find(
    (p) => p.position.coin === coin && Math.abs(parseFloat(p.position.szi)) > 0
  );

  if (!realPosition) {
    logInfo(`[executeExit] No open position for ${coin}`);
    return;
  }

  const entryPx = parseFloat(realPosition.position.entryPx);
  const szi = parseFloat(realPosition.position.szi);
  const isShort = szi < 0;
  const rawQty = Math.abs(szi);

  const { canTrade, qty: safeQty } = await checkRiskGuards(
    hyperliquid,
    vaultAddress,
    rawQty,
    exitIntent.price,
    coinMeta
  );

  if (!canTrade) {
    logInfo(`[executeExit] Risk guards blocked exit for ${coin}`);
    return;
  }

  const tidyQty = Number(safeQty.toFixed(coinMeta.szDecimals));
  const pxDecimals = coinMeta.pxDecimals ?? 2;
  const tidyPx = Number(exitIntent.price.toFixed(pxDecimals));
  const exitSide = isShort ? 'BUY' : 'SELL';

  const ok = await placeOrderSafe(
    hyperliquid,
    coin,
    exitSide === 'BUY',
    tidyQty,
    tidyPx,
    true,
    'Ioc',
    vaultAddress,
    pxDecimals // ✅ FIXED
  );

  if (!ok) {
    logError(`[executeExit] ❌ Exit failed for ${coin}`);
    return;
  }

  logExit({ asset: coin, price: tidyPx, reason: exitIntent.reason });

  const pnl = (tidyPx - entryPx) * tidyQty * (isShort ? -1 : 1);
  if (pnl < 0) {
    stateManager.addLoss(Math.abs(pnl));
  } else {
    stateManager.addProfit(pnl);
  }

  logInfo(`[executeExit] ✅ Closed ${coin} | PnL ${pnl.toFixed(2)}`);
};
