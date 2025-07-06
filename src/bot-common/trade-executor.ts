import { logInfo, logError, logExit } from './utils/logger.js';
import { stateManager } from './state-manager.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { Analysis } from './analyse-asset.js';
import type { BotConfig } from '../bots/config/bot-config.js';
import { checkRiskGuards } from './utils/risk-guards.js';

// === TYPES ===

export interface ConfigAsset {
  maxPositionUsd: number;
  leverage: number;
}

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

// === CONSTANTS ===

const DEFAULT_MAX_SLIPPAGE_PCT = 0.002; // 0.2%

// === PLACE ORDER ===

export const placeOrder = async (
  hyperliquid: Hyperliquid,
  coin: string,
  isBuy: boolean,
  size: number,
  limitPrice: number,
  reduceOnly = false
): Promise<void> => {
  const px = isBuy ? limitPrice * 1.01 : limitPrice * 0.99;

  logInfo(
    `[TradeExecutor] Placing IOC → coin=${coin} isBuy=${isBuy} size=${size} limitPrice=${px.toFixed(4)} reduceOnly=${reduceOnly}`
  );

  await hyperliquid.exchange.placeOrder({
    coin,
    is_buy: isBuy,
    sz: size,
    limit_px: px.toString(),
    order_type: { limit: { tif: 'Ioc' } }, // simulate market
    reduce_only: reduceOnly,
  });
};

// === ENTRY ===

export const executeEntry = async (
  hyperliquid: Hyperliquid,
  walletAddress: string,
  coin: string,
  entryPrice: number,
  capitalRiskUsd: number,
  leverage: number,
  side: 'BUY' | 'SELL',
  strategy: 'breakout' | 'trend' | 'reversion'
): Promise<void> => {

  const canTrade = await checkRiskGuards(hyperliquid, walletAddress)

  if (!canTrade) {
    logInfo(`[TradeExecutor] Risk guards failed, skipping entry for ${coin}`);
    return;
  }

  if (process.env.DRY_RUN === 'true') {
    logInfo(
      `[DryRun] Would place entry → ${coin} ${side} $${capitalRiskUsd} @ ${entryPrice} x${leverage}`
    );
    return;
  }

  const positionValueUsd = capitalRiskUsd * leverage;
  const qty = Number((positionValueUsd / entryPrice).toFixed(6));

  if (strategy === 'reversion') {
    // Proper limit order: GTC
    const px = entryPrice;
    logInfo(
      `[TradeExecutor] Placing LIMIT GTC → ${coin} ${side} qty=${qty} px=${px} lev=${leverage}x`
    );
    await hyperliquid.exchange.placeOrder({
      coin,
      is_buy: side === 'BUY',
      sz: qty,
      limit_px: px.toString(),
      order_type: { limit: { tif: 'Gtc' } },
      reduce_only: false,
    });
  } else {
    // Simulated market order: limit IOC with slippage guard
    const px = side === 'BUY'
      ? entryPrice * (1 + DEFAULT_MAX_SLIPPAGE_PCT)
      : entryPrice * (1 - DEFAULT_MAX_SLIPPAGE_PCT);

    logInfo(
      `[TradeExecutor] Placing IOC (simulated MARKET) → ${coin} ${side} qty=${qty} px=${px} lev=${leverage}x`
    );

    await hyperliquid.exchange.placeOrder({
      coin,
      is_buy: side === 'BUY',
      sz: qty,
      limit_px: px.toString(),
      order_type: { limit: { tif: 'Ioc' } },
      reduce_only: false,
    });
  }
};

// === EXIT ===

export const executeExit = async (
  hyperliquid: Hyperliquid,
  coin: string,
  exitIntent: ExitIntent
): Promise<void> => {
  await placeOrder(hyperliquid, coin, false, exitIntent.quantity, exitIntent.price, true);

  logExit({
    asset: coin,
    price: exitIntent.price,
    reason: exitIntent.reason,
  });

  const position = stateManager.getActivePosition(coin);
  if (position) {
    const entry = position.entryPrice;
    const pnl = (exitIntent.price - entry) * exitIntent.quantity * (position.isShort ? -1 : 1);
    if (pnl < 0) {
      stateManager.addLoss(Math.abs(pnl));
    } else {
      stateManager.addProfit(pnl);
    }
  }

  stateManager.removeActivePosition(coin);
};

// === AUTO EXIT ===

export const handleExit = async (
  hyperliquid: Hyperliquid,
  coin: string,
  config: BotConfig,
  analysis: Analysis
): Promise<void> => {
  const position = stateManager.getActivePosition(coin);
  if (!position) return;

  const shouldExit =
    checkTrailingStop(position, analysis, config) || checkTakeProfit(position, analysis, config);

  if (!shouldExit) return;

  try {
    logInfo(`[handleExit] Closing position for ${coin}...`);

    const isBuy = position.isShort;

    await placeOrder(hyperliquid, coin, isBuy, position.qty, analysis.currentPrice, true);

    const entry = position.entryPrice;
    const pnl = (analysis.currentPrice - entry) * position.qty * (position.isShort ? -1 : 1);
    if (pnl < 0) {
      stateManager.addLoss(Math.abs(pnl));
    } else {
      stateManager.addProfit(pnl);
    }

    stateManager.removeActivePosition(coin);

    logExit({
      asset: coin,
      price: analysis.currentPrice,
      reason: 'TrailingStopOrTP',
    });

    logInfo(`[handleExit] Position closed for ${coin}`);
  } catch (err: any) {
    logError(`[handleExit] Failed to close for ${coin}: ${err.message}`);
  }
};

// === HELPERS ===

const checkTrailingStop = (position: Position, analysis: Analysis, config: BotConfig): boolean => {
  const dropPct = ((position.highestPrice - analysis.currentPrice) / position.highestPrice) * 100;
  return dropPct >= (config.trailingStopPct ?? 0);
};

const checkTakeProfit = (position: Position, analysis: Analysis, config: BotConfig): boolean => {
  const gainPct = ((analysis.currentPrice - position.entryPrice) / position.entryPrice) * 100;
  return gainPct >= (config.initialTakeProfitPct ?? 0);
};

// === DAILY LOSS MANAGEMENT ===
export const resetDailyLoss = (): void => {
  stateManager.resetDailyLoss();
};