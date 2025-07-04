import { logInfo, logError, logTrade, logExit } from './utils/logger.js';
import { stateManager } from './state-manager.js';
import type { Hyperliquid } from '../sdk/index.js';
import { Analysis } from './analyse-asset.js';
import { BotConfig } from '../bots/config/bot-config.js';

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

  console.log(
    `[DEBUG] Placing order | coin=${coin} isBuy=${isBuy} size=${size} limitPrice=${px} reduceOnly=${reduceOnly}`
  );

  await hyperliquid.exchange.placeOrder({
    coin: coin,
    is_buy: isBuy,
    sz: size,
    limit_px: px,
    order_type: { limit: { tif: 'Ioc' } }, // Immediate Or Cancel
    reduce_only: reduceOnly,
  });
};

// === ENTRY ===

export const executeEntry = async (
  hyperliquid: any,
  coin: string,
  entryPrice: number,
  capitalRiskUsd: number,
  leverage: number,
  side: 'BUY' | 'SELL',
) => {

  if (process.env.DRY_RUN === 'true') {
    console.log(`[DryRun] Would place order → ${coin} ${side} $${capitalRiskUsd} @ ${entryPrice}x${leverage}`);
    return;
  }

  try {
    const positionValueUsd = capitalRiskUsd * leverage;
    const qty = Number((positionValueUsd / entryPrice).toFixed(6));

    const order = {
      coin: coin,
      is_buy: side === 'BUY',
      sz: qty,
      limit_px: entryPrice.toString(),
      order_type: { limit: { tif: 'Gtc' } },
      reduce_only: false,
    };

    logInfo(
      `[TradeExecutor] Placing entry → ${coin} | Side: ${side} | USD: ${positionValueUsd.toFixed(2)} | Qty: ${qty} | Px: ${entryPrice} | Leverage: ${leverage}x`
    );

    const result = await hyperliquid.exchange.placeOrder(order);

    logInfo(`[TradeExecutor] Order result → ${JSON.stringify(result)}`);

  } catch (err: any) {
    logError(`[TradeExecutor] executeEntry failed: ${err.message}`);
    throw err;
  }
}


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
