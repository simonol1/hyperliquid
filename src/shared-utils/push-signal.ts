import { redis } from "./redis-client.js";
import { logDebug, logInfo, logWarn } from "./logger.js";
import type { SignalMessage } from './types.js';

const TRADE_SIGNALS_QUEUE = 'trade_signals';

/**
 * Push a trade signal OR a bot completion status.
 * All go to the single trade_signals queue.
 */
export const pushSignal = async (signal: SignalMessage): Promise<void> => {
    const stringify = (s: SignalMessage) => JSON.stringify(s, null, 2);

    await redis.rPush(TRADE_SIGNALS_QUEUE, stringify(signal));

    if ('coin' in signal) {
        logDebug(`[PushSignal] ✅ Pushed trade: ${signal.coin}`);
    } else if ('status' in signal && signal.status === 'BOT_DONE') {
        logDebug(`[PushSignal] ✅ ${signal.bot} completed`);
    } else {
        logWarn(`[PushSignal] ⚠️ Unknown signal format: ${stringify(signal)}`);
    }
};

