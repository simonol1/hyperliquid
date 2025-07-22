// ✅ File: reporter/reporter.ts (Updated with Active Trades Summary)
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

const fetchActiveTrades = async () => {
    const keys = await redis.keys('trade:*');
    const raw = await Promise.all(keys.map(k => redis.get(k)));
    return raw
        .filter((x): x is string => !!x)
        .map(x => JSON.parse(x))
        .filter((t: any) => t.status === 'open');
};

const buildPnLSummary = (tradesByBot: Record<string, any[]>, activeTrades: any[]) => {
    let summaryLines = ['📊 *Twice Daily Summary*'];

    for (const bot of bots) {
        const trades = tradesByBot[bot] || [];
        const total = trades.length;
        const wins = trades.filter(t => t.pnl > 0).length;
        const losses = total - wins;
        const pnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
        const winRate = total ? ((wins / total) * 100).toFixed(1) : '0';

        summaryLines.push(`\n*${bot.toUpperCase()}*`);
        summaryLines.push(`Closed: ${total} | Wins: ${wins} | Losses: ${losses}`);
        summaryLines.push(`Win Rate: ${winRate}%`);
        summaryLines.push(`Net PnL: $${pnl.toFixed(2)}`);
    }

    if (activeTrades.length) {
        summaryLines.push(`\n🟢 *Active Trades* (${activeTrades.length}):`);
        for (const trade of activeTrades) {
            summaryLines.push(`${trade.bot.toUpperCase()} ${trade.coin} ${trade.side} @ ${trade.entryPrice.toFixed(2)} | Open PnL: $${(trade.pnl ?? 0).toFixed(2)}`);
        }
    } else {
        summaryLines.push(`\n⚪ *No Active Trades*`);
    }

    return summaryLines.join('\n');
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

        const tradesByBot: Record<string, any[]> = {};
        for (const bot of bots) {
            try {
                const trades = await fetchClosedTrades(bot);
                tradesByBot[bot] = trades;
            } catch (err) {
                logError(`[Reporter] ❌ Error fetching trades for ${bot}: ${err}`);
                tradesByBot[bot] = [];
            }
        }

        const activeTrades = await fetchActiveTrades();
        const summary = buildPnLSummary(tradesByBot, activeTrades);
        await sendTelegramMessage(summary, chatId);
        logInfo(`[Reporter] ✅ Sent combined PnL and Active Trades summary`);
    });
    logInfo(`🕖 Twice daily PnL report scheduled for 7am and 7pm AEST`);
};
