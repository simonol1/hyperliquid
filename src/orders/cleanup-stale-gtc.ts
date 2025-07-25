import { redis } from './../shared-utils/redis-client.js'
import { logDebug, logInfo } from './../shared-utils/logger.js';
import type { Hyperliquid } from '../sdk/index.js';

export const cleanupStaleGtcExits = async (
    hyperliquid: Hyperliquid,
    subaccountAddress: string,
    coins: string[]
) => {
    const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
    const activePositions = perpState.assetPositions.filter(
        (p) => Math.abs(parseFloat(p.position.szi)) > 0
    ).map(p => p.position.coin);

    for (const coin of coins) {
        const key = `openExit:${coin}:${subaccountAddress}`;
        const pending = await redis.get(key);

        if (pending && !activePositions.includes(coin)) {
            await redis.del(key);
            logInfo(`[Cleanup] 🧹 Removed stale openExit for ${coin}`);
        } else if (pending) {
            logDebug(`[Cleanup] 🔒 Still active position for ${coin}, keeping openExit`);
        }
    }
};
