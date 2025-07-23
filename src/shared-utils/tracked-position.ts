// --- tracked-position.ts ---

import { redis } from './redis-client';

export interface Position {
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

export const setTrackedPosition = async (coin: string, position: Position) => {
    await redis.set(`position:${coin}`, JSON.stringify(position), { EX: 86400 });
};

export const updateTrackedPosition = async (coin: string, updates: Partial<Position>) => {
    const raw = await redis.get(`position:${coin}`);
    if (!raw) return;

    const existing: Position = JSON.parse(raw);
    const updated = { ...existing, ...updates };

    await redis.set(`position:${coin}`, JSON.stringify(updated), { EX: 86400 });
};

export const getTrackedPosition = async (coin: string): Promise<Position | null> => {
    const raw = await redis.get(`position:${coin}`);
    if (!raw) return null;
    return JSON.parse(raw);
};
