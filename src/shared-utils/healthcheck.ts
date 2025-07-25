import { redis } from './redis-client.js';

export type BotOrWorker =
    | 'trend'
    | 'breakout'
    | 'reversion'
    | 'orchestrator'
    | 'exits'

export const updateBotErrorStatus = async (
    bot: BotOrWorker,
    err: Error
) => {
    const message = `🔴 Error: ${err.message.slice(0, 100)}`;
    await redis.set(`status:${bot}`, message, { EX: 3600 });
};

export const updateBotStatus = async (bot: BotOrWorker) => {
    await redis.set(`status:${bot}`, `🟢 Tick: ${new Date().toISOString()}`, {
        EX: 3600,
    });
};
