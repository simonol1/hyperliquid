import { redis } from "./redis-client.js";
import { logDebug, logInfo, logWarn, logError } from "./logger.js";
import type { SignalMessage } from './types.js';

const TRADE_SIGNALS_QUEUE = 'trade_signals';

/**
 * Push a trade signal OR a bot completion status.
 * All go to the single trade_signals queue.
 */
export const pushSignal = async (signal: SignalMessage): Promise<void> => {
    const stringify = (s: SignalMessage) => JSON.stringify(s, null, 2);
    const signalString = stringify(signal);

    logDebug(`[PushSignal] Attempting to push signal: ${signalString}`); // Log before push

    try {
        // Attempt to push to Redis
        const result = await redis.rPush(TRADE_SIGNALS_QUEUE, signalString);
        logDebug(`[PushSignal] Redis rPush result: ${result}`); // Log the result of the rPush operation

        if ('coin' in signal) {
            logInfo(`[PushSignal] ✅ Pushed trade signal for: ${signal.coin}`); // Changed to logInfo for better visibility in typical logs
        } else if ('status' in signal && signal.status === 'BOT_COMPLETED') {
            logInfo(`[PushSignal] ✅ ${signal.bot} completed signal pushed`); // Changed to logInfo
        } else {
            logWarn(`[PushSignal] ⚠️ Unknown signal format: ${signalString}`);
        }
    } catch (err: any) {
        // Catch and log any errors that occur during the Redis push operation
        logError(`[PushSignal] ❌ Error pushing to Redis: ${err.message}. Signal: ${signalString}`);
    }
};
