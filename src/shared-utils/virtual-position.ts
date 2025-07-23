import { getTrackedPosition } from './tracked-position.js';
import type { Position } from './tracked-position.js';

export const buildVirtualPositionFromLive = async (
    coin: string,
    szi: number,
    entryPx: number
): Promise<Position | null> => {
    const tracked = await getTrackedPosition(coin);
    if (!tracked) return null;

    return {
        ...tracked,
        qty: Math.abs(szi),
        entryPrice: entryPx,
        isLong: szi > 0,
    };
};

