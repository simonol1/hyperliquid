import { redis } from './redis-client.js';

export const updateBotErrorStatus = async (
    bot: 'trend' | 'breakout' | 'reversion',
    err: Error
) => {
    const message = `🔴 Error: ${err.message.slice(0, 100)}`;
    await redis.set(`status:${bot}`, message, { EX: 3600 });
};

export const updateBotStatus = async (bot: 'trend' | 'breakout' | 'reversion') => {
    await redis.set(`status:${bot}`, `🟢 Tick: ${new Date().toISOString()}`, {
        EX: 3600,
    });
};