import { createClient } from 'redis';
import { logInfo, logError } from './logger.js';

export const redis = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redis.on('error', async (err) => {
    logError(`[Redis Client] ❌ Error: ${err.message}`);

    try {
        await redis.connect();
        logInfo('[Redis Client] ✅ Connected successfully'); // Log successful connection
    } catch (err: any) {
        logError(`[Redis Client] ❌ Failed to connect: ${err.message}`); // Log connection failure
        // Consider exiting the process if Redis is a critical dependency for the bot
        process.exit(1);
    }
})