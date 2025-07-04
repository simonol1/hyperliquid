// src/bot-common/state-manager.ts

import { Position } from './trade-executor';

type PositionsMap = Record<string, Position | undefined>;
type CooldownsMap = Record<string, number | undefined>;

const activePositions: PositionsMap = {};
const cooldowns: CooldownsMap = {};

export const stateManager = {
  /**
   * Get active position for an asset.
   */
  getActivePosition: (asset: string): Position | undefined => {
    return activePositions[asset];
  },

  /**
   * Set or update active position for an asset.
   */
  setActivePosition: (asset: string, positionData: Partial<Position>): void => {
    const existing = activePositions[asset];

    const qty = positionData.qty ?? existing?.qty;
    const entryPrice = positionData.entryPrice ?? existing?.entryPrice;
    const isShort = positionData.isShort ?? existing?.isShort;

    if (qty === undefined || entryPrice === undefined || isShort === undefined) {
      throw new Error(
        `Missing required fields for position: qty=${qty}, entryPrice=${entryPrice}, isShort=${isShort}`
      );
    }

    activePositions[asset] = {
      qty,
      entryPrice,
      highestPrice:
        positionData.highestPrice !== undefined
          ? positionData.highestPrice
          : existing?.highestPrice ?? entryPrice,
      isShort,
      takeProfitTarget: positionData.takeProfitTarget ?? existing?.takeProfitTarget,
    };
  },

  /**
   * Remove position for an asset.
   */
  removeActivePosition: (asset: string): void => {
    delete activePositions[asset];
  },

  /**
   * Set cooldown timer for an asset.
   */
  setCooldown: (asset: string, durationMs: number): void => {
    cooldowns[asset] = Date.now() + durationMs;
  },

  /**
   * Check if an asset is cooling down.
   */
  isInCooldown: (asset: string): boolean => {
    const expiry = cooldowns[asset];
    return expiry !== undefined && Date.now() < expiry;
  },

  /**
   * Get snapshot of all active positions.
   */
  getAllActivePositions: (): PositionsMap => {
    return { ...activePositions };
  },
};
