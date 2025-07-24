// ✅ File: reporter/reporter.ts (Updated with Active Trades Summary)
import { sendTelegramMessage, summaryChatId, escapeMarkdown } from '../shared-utils/telegram.js';
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

        summaryLines.push(`\n*${escapeMarkdown(bot.toUpperCase())}*`);
        summaryLines.push(`Closed: ${escapeMarkdown(total.toString())} | Wins: ${escapeMarkdown(wins.toString())} | Losses: ${escapeMarkdown(losses.toString())}`);
        summaryLines.push(`Win Rate: ${escapeMarkdown(winRate)}%`);
        summaryLines.push(`Net PnL: $${escapeMarkdown(pnl.toFixed(2))}`);
    }

    if (activeTrades.length) {
        summaryLines.push(`\n🟢 *Active Trades* (${escapeMarkdown(activeTrades.length.toString())}):`);
        for (const trade of activeTrades) {
            summaryLines.push(`${escapeMarkdown(trade.bot.toUpperCase())} ${escapeMarkdown(trade.coin)} ${escapeMarkdown(trade.side)} @ ${escapeMarkdown(trade.entryPrice.toFixed(2))} | Open PnL: $${escapeMarkdown((trade.pnl ?? 0).toFixed(2))}`);
        }
    } else {
        summaryLines.push(`\n⚪ *No Active Trades*`);
    }

    return summaryLines.join('\n');
};


export const schedulePnLSummaryEvery4Hours = () => {
    cron.schedule('0 */4 * * *', async () => {
        logInfo(`📢 Starting 4-hour PnL Summary...`);
        if (!summaryChatId) {
            logError("❌ Missing Telegram summary Chat ID - cannot send PnL report");
            return;
        }

        const tradesByBot: Record<string, any[]> = {};
        for (const bot of bots) {
            try {
                const trades = await fetchClosedTrades(bot, Date.now() - 4 * 60 * 60 * 1000);
                tradesByBot[bot] = trades;
            } catch (err) {
                logError(`[Reporter] ❌ Error fetching trades for ${bot}: ${err}`);
                tradesByBot[bot] = [];
            }
        }

        const activeTrades = await fetchActiveTrades();
        const summary = buildPnLSummary(tradesByBot, activeTrades);
        await sendTelegramMessage(summary, summaryChatId);
        logInfo(`[Reporter] ✅ Sent 4-hour PnL and Active Trades summary`);
    });

    logInfo(`🕓 4-hourly PnL report scheduled`);
};

