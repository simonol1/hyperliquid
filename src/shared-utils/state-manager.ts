// src/bot-common/state-manager.ts

/**
 * State manager for bots:
 * - Cooldowns per coin
 * - High watermarks for trailing stop tracking
 * - Daily PnL tracking
 */

type CooldownsMap = Record<string, number | undefined>;
type HighWatermarksMap = Record<string, number>;

let dailyLossUsd = 0;
const cooldowns: CooldownsMap = {};
const highWatermarks: HighWatermarksMap = {};

/**
 * Track trailing stop: store or update a coin’s high or low water mark.
 * Long: new high = update. Short: new low = update.
 */
export const stateManager = {
  /**
   * Set or update high watermark for a coin.
   * @param coin 
   * @param price 
   * @param isShort 
   */
  setHighWatermark: (coin: string, price: number, isShort: boolean) => {
    const current = highWatermarks[coin];
    if (current === undefined) {
      highWatermarks[coin] = price;
      return;
    }
    if (!isShort && price > current) {
      highWatermarks[coin] = price;
    }
    if (isShort && price < current) {
      highWatermarks[coin] = price;
    }
  },

  /**
   * Get stored high watermark for a coin.
   * @param coin 
   */
  getHighWatermark: (coin: string): number | undefined => {
    return highWatermarks[coin];
  },

  /**
   * Clear high watermark after an exit.
   * @param coin 
   */
  clearHighWatermark: (coin: string) => {
    delete highWatermarks[coin];
  },

  // === Cooldowns ===

  /**
   * Start cooldown timer for a coin.
   * @param asset 
   * @param durationMs 
   */
  setCooldown: (asset: string, durationMs: number): void => {
    cooldowns[asset] = Date.now() + durationMs;
  },

  /**
   * Check if a coin is in cooldown.
   * @param asset 
   */
  isInCooldown: (asset: string): boolean => {
    const expiry = cooldowns[asset];
    return expiry !== undefined && Date.now() < expiry;
  },

  // === Daily PnL ===

  /**
   * Add loss to daily running total.
   * @param amountUsd 
   */
  addLoss: (amountUsd: number): void => {
    dailyLossUsd += amountUsd;
    console.log(
      `[StateManager] ➖ Recorded loss: $${amountUsd.toFixed(2)} → Net today: $${dailyLossUsd.toFixed(2)}`
    );
  },

  /**
   * Add profit to daily running total.
   * @param amountUsd 
   */
  addProfit: (amountUsd: number): void => {
    dailyLossUsd -= amountUsd;
    console.log(
      `[StateManager] ➕ Recorded profit: $${amountUsd.toFixed(2)} → Net today: $${dailyLossUsd.toFixed(2)}`
    );
  },

  /**
   * Get total daily loss or profit.
   */
  getDailyLossUsd: (): number => {
    return dailyLossUsd;
  },

  /**
   * Reset daily PnL.
   */
  resetDailyLoss: (): void => {
    dailyLossUsd = 0;
    console.log(`[StateManager] 🔄 Daily loss counter reset.`);
  },
};
