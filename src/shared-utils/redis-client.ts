import { createClient } from 'redis';
import { logInfo, logError, logWarn } from './logger.js'; // Ensure all logger functions are imported

export const redis = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    // Add retry strategy for better resilience
    socket: {
        connectTimeout: 10000, // Add a connection atimeout (e.g., 10 seconds)
        reconnectStrategy: (retries) => {
            if (retries > 20) { // Limit retries to prevent infinite loops
                logError('[Redis Client] Max reconnection attempts reached. Giving up.');
                return new Error('Max reconnection attempts reached');
            }
            const delay = Math.min(retries * 50, 5000); // Exponential backoff, max 5 seconds
            logWarn(`[Redis Client] Reconnecting to Redis (attempt ${retries}). Retrying in ${delay}ms...`);
            return delay;
        }
    }
});

redis.on('connect', () => {
    logInfo('[Redis Client] ⚡️ Connection to Redis established.');
});

redis.on('ready', () => {
    logInfo('[Redis Client] ✅ Redis client is ready.');
});

redis.on('end', () => {
    logWarn('[Redis Client] 🔌 Connection to Redis has been closed.');
});

redis.on('error', (err) => {
    logError(`[Redis Client] ❌ Error: ${JSON.stringify(err)}`);
});

// Immediately attempt to connect.
// The `await` here ensures that any module importing this waits for the initial connection.
// However, the `runTrendBot` loop continues even if this initial connect fails,
// so the `socket.reconnectStrategy` is key for resilience.
(async () => {
    try {
        await redis.connect();
        // Initial connection log is now handled by 'connect' and 'ready' events
    } catch (err: any) {
        // This catch block handles the initial connection failure before the reconnectStrategy kicks in
        logError(`[Redis Client] ❌ Initial connection attempt failed: ${err.message}`);
        // Do NOT exit here, let the reconnectStrategy handle it or the main app logic decide
    }
})();
