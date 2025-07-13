import { sendTelegramMessage } from './telegram.js';
import { logInfo, logError } from './logger.js';
import { redis } from './redis-client.js';
import cron from 'node-cron';

const bots = ['trend', 'breakout', 'reversion'] as const;

const fetchClosedTrades = async (bot: string, sinceMs?: number) => {
    const keys = await redis.keys('trade:*');
    const raw = await Promise.all(keys.map(k => redis.get(k)));
    return raw
        .filter((x): x is string => !!x)
        .map(x => JSON.parse(x))
        .filter((t: any) =>
            t.status === 'closed' &&
            t.bot === bot &&
            (!sinceMs || t.closedAt >= sinceMs)
        );
};

const buildSummary = (bot: string, trades: any[], label: string) => {
    const total = trades.length;
    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = total - wins;
    const pnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const winRate = total ? ((wins / total) * 100).toFixed(1) : '0';

    return `
    ${label} *${bot.toUpperCase()}*
    Trades Closed: ${total}
    Wins: ${wins}
    Losses: ${losses}
    Win Rate: ${winRate}%
    Net PnL: $${pnl.toFixed(2)}
  `.trim();
};

// --- Exposed Schedulers ---
export const scheduleDailyReport = () => {
    cron.schedule('0 21 * * *', async () => {
        for (const bot of bots) {
            try {
                const trades = await fetchClosedTrades(bot);
                const summary = buildSummary(bot, trades, '📊 Daily PnL');
                await sendTelegramMessage(summary);
                logInfo(`[Reporter] ✅ Sent daily for ${bot}`);
            } catch (err) {
                logError(`[Reporter] ❌ Daily failed for ${bot}: ${err}`);
            }
        }
    });

    logInfo(`🕘 Daily report scheduled for 21:00`);
};

export const scheduleHourlyReport = () => {
    cron.schedule('0 * * * *', async () => {
        const since = Date.now() - 60 * 60 * 1000;
        for (const bot of bots) {
            try {
                const trades = await fetchClosedTrades(bot, since);
                const summary = buildSummary(bot, trades, '🕒 Hourly Report');
                await sendTelegramMessage(summary);
                logInfo(`[Reporter] ✅ Sent hourly for ${bot}`);
            } catch (err) {
                logError(`[Reporter] ❌ Hourly failed for ${bot}: ${err}`);
            }
        }
    });

    logInfo(`🕐 Hourly report scheduled on the hour`);
};
