import { redis } from '../shared-utils/redis-client.js';
import { stateManager } from '../shared-utils/state-manager.js';

export interface VirtualPosition {
    qty: number;
    entryPrice: number;
    highestPrice: number;
    isLong: boolean;
    takeProfitTarget?: number;
    trailingStopTarget?: number;
    openedAt?: number;
}

export const buildVirtualPositionFromLive = async (
    coin: string,
    liveQty: number,
    liveEntryPrice: number
): Promise<VirtualPosition | null> => {
    const redisRaw = await redis.get(`position:${coin}`);
    if (!redisRaw) return null;

    const tracked = JSON.parse(redisRaw);
    const isLong = liveQty > 0;

    return {
        qty: Math.abs(liveQty),
        entryPrice: liveEntryPrice,
        isLong,
        highestPrice: stateManager.getHighWatermark(coin) ?? liveEntryPrice,
        takeProfitTarget: tracked.takeProfitTarget,
        trailingStopTarget: tracked.trailingStopTarget,
        openedAt: tracked.openedAt,
    };
};
