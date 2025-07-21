// ✅ File: reporter/reporter.ts
import { sendTelegramMessage } from '../shared-utils/telegram.js';
import { logInfo, logError } from '../shared-utils/logger.js';
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

    return [
        `${label} *${bot.toUpperCase()}*`,
        `Closed: ${total} | Wins: ${wins} | Losses: ${losses}`,
        `Win Rate: ${winRate}%`,
        `Net PnL: $${pnl.toFixed(2)}`
    ].join('\n');
};

export const scheduleTwiceDailyReport = () => {
    // 7am and 7pm AEST -> 9pm and 9am UTC
    cron.schedule('0 21,9 * * *', async () => {
        logInfo(`📢 Starting Twice Daily PnL Report...`);
        const chatId = process.env.TELEGRAM_TRADE_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
        if (!chatId) {
            logError("❌ Missing Telegram Chat ID - cannot send PnL report");
            return;
        }

        for (const bot of bots) {
            try {
                const trades = await fetchClosedTrades(bot);
                const summary = buildPnLSummary(bot, trades, '📊 Twice Daily Summary');
                await sendTelegramMessage(summary, chatId);
                logInfo(`[Reporter] ✅ Sent PnL report for ${bot}`);
            } catch (err) {
                logError(`[Reporter] ❌ Failed report for ${bot}: ${err}`);
            }
        }
    });
    logInfo(`🕖 Twice daily PnL report scheduled for 7am and 7pm AEST`);
};
