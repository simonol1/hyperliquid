// ✅ File: reporter/reporter.ts
import { sendTelegramMessage } from '../shared-utils/telegram.js';
import { logInfo, logError, logWarn } from '../shared-utils/logger.js';
import { redis } from '../shared-utils/redis-client.js';
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

const buildPnLSummary = (bot: string, trades: any[], label: string) => {
    const total = trades.length;
    const wins = trades.filter(t => t.pnl > 0).length;
    const losses = total - wins;
    const pnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const winRate = total ? ((wins / total) * 100).toFixed(1) : '0';

    return `
${label} *${bot.toUpperCase()}*
Closed: ${total} | Wins: ${wins} | Losses: ${losses}
Win Rate: ${winRate}%
Net PnL: $${pnl.toFixed(2)}
`.trim();
};

// Daily Report to PnL Telegram Channel
export const scheduleDailyReport = () => {
    cron.schedule('0 21 * * *', async () => {
        for (const bot of bots) {
            try {
                const trades = await fetchClosedTrades(bot);
                const summary = buildPnLSummary(bot, trades, '📊 Daily Summary');

                const chatId = process.env.TELEGRAM_TRADE_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
                if (!chatId) throw new Error("Missing Telegram Chat ID");
                await sendTelegramMessage(summary, chatId);

                logWarn(`[Reporter] ✅ Sent daily report for ${bot}`);
            } catch (err) {
                logError(`[Reporter] ❌ Daily failed for ${bot}: ${err}`);
            }
        }
    });
    logInfo(`🕘 Daily PnL report scheduled for 21:00`);
};

// Hourly Report to PnL Telegram Channel
export const scheduleHourlyReport = () => {
    cron.schedule('0 * * * *', async () => {
        const since = Date.now() - 60 * 60 * 1000;
        for (const bot of bots) {
            try {
                const trades = await fetchClosedTrades(bot, since);
                const summary = buildPnLSummary(bot, trades, '🕒 Hourly Report');

                const chatId = process.env.TELEGRAM_TRADE_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
                if (!chatId) throw new Error("Missing Telegram Chat ID");
                await sendTelegramMessage(summary, chatId);

                logWarn(`[Reporter] ✅ Sent hourly report for ${bot}`);
            } catch (err) {
                logError(`[Reporter] ❌ Hourly failed for ${bot}: ${err}`);
            }
        }
    });
    logInfo(`🕐 Hourly PnL report scheduled on the hour`);
};
