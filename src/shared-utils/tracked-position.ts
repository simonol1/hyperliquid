import { redis } from './redis-client.js'; // Ensure .js extension for ES Modules
import { logDebug, logError, logWarn } from './logger.js'; // Import logger functions

export interface Position {
    tradeId: string; // Link to the TradeTracker record
    qty: number;
    entryPrice: number;
    highestPrice: number;
    isLong: boolean;
    leverage: number;
    openedAt: number;

    takeProfitTarget?: number;
    takeProfitLevels?: number[];         // e.g. [1.5, 3, 5]
    takeProfitHit?: number[];            // e.g. [1.5] means 3 and 5 still active

    trailingStopTarget?: number;
    trailingStopPct?: number;
    trailingStopActive?: boolean;

    breakevenTriggered?: boolean;
}

const POSITION_PREFIX = 'position:'; // Define a prefix for consistency

export const setTrackedPosition = async (coin: string, position: Position) => {
    logDebug(`[TrackedPosition] Setting tracked position for ${coin} with tradeId: ${position.tradeId}`);
    try {
        // Expiration time for tracked positions (e.g., 24 hours)
        await redis.set(`${POSITION_PREFIX}${coin}`, JSON.stringify(position), { EX: 86400 });
        logDebug(`[TrackedPosition] Successfully set tracked position for ${coin}.`);
    } catch (err: any) {
        logError(`[TrackedPosition] ❌ Failed to set tracked position for ${coin}: ${err.message || JSON.stringify(err)}`);
    }
};

export const updateTrackedPosition = async (coin: string, updates: Partial<Position>) => {
    logDebug(`[TrackedPosition] Updating tracked position for ${coin}. Updates: ${JSON.stringify(updates)}`);
    const raw = await redis.get(`${POSITION_PREFIX}${coin}`);
    if (!raw) {
        logWarn(`[TrackedPosition] ⚠️ No existing tracked position found for ${coin} to update.`);
        return;
    }

    try {
        const existing: Position = JSON.parse(raw);
        const updated = { ...existing, ...updates };

        await redis.set(`${POSITION_PREFIX}${coin}`, JSON.stringify(updated), { EX: 86400 });
        logDebug(`[TrackedPosition] Successfully updated tracked position for ${coin}.`);
    } catch (err: any) {
        logError(`[TrackedPosition] ❌ Failed to update tracked position for ${coin}: ${err.message || JSON.stringify(err)}`);
    }
};

export const getTrackedPosition = async (coin: string): Promise<Position | null> => {
    logDebug(`[TrackedPosition] Getting tracked position for ${coin}.`);
    const raw = await redis.get(`${POSITION_PREFIX}${coin}`);
    if (!raw) {
        logDebug(`[TrackedPosition] No raw tracked position data found for ${coin}.`);
        return null;
    }
    try {
        const position = JSON.parse(raw);
        logDebug(`[TrackedPosition] Successfully retrieved tracked position for ${coin}.`);
        return position;
    } catch (err: any) {
        logError(`[TrackedPosition] ❌ Error parsing tracked position JSON for ${coin}: ${err.message || JSON.stringify(err)}. Raw: ${raw}`);
        return null;
    }
};
