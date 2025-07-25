import { sendTelegramMessage, summaryChatId, escapeMarkdown } from '../shared-utils/telegram.js';
import { logInfo, logError } from '../shared-utils/logger.js';
import cron from 'node-cron';
import { TradeRecord, TradeTracker } from '../shared-utils/trade-tracker.js';

const bots = ['trend', 'breakout', 'reversion'] as const;

const buildPnLSummary = (
    tradesByBot: Record<string, TradeRecord[]>,
    activeTrades: TradeRecord[]
): string => {
    const summaryLines = ['📊 *Twice Daily Summary*'];

    let hasAnyClosed = false;

    for (const bot of bots) {
        const trades = tradesByBot[bot] || [];
        const total = trades.length;

        if (total > 0) hasAnyClosed = true;

        const wins = trades.filter(t => typeof t.pnl === 'number' && t.pnl > 0).length;
        const losses = total - wins;
        const pnl = trades.reduce((sum, t) => sum + (typeof t.pnl === 'number' ? t.pnl : 0), 0);
        const winRate = total ? ((wins / total) * 100).toFixed(1) : '0.0';

        summaryLines.push(`\n*${escapeMarkdown(bot.toUpperCase())}*`);
        summaryLines.push(`Closed: ${escapeMarkdown(total.toString())} | Wins: ${escapeMarkdown(wins.toString())} | Losses: ${escapeMarkdown(losses.toString())}`);
        summaryLines.push(`Win Rate: ${escapeMarkdown(winRate)}%`);
        summaryLines.push(`Net PnL: $${escapeMarkdown(pnl.toFixed(2))}`);
    }

    if (activeTrades.length > 0) {
        summaryLines.push(`\n🟢 *Active Trades* (${escapeMarkdown(activeTrades.length.toString())}):`);
        for (const trade of activeTrades) {
            const entry = typeof trade.entryPrice === 'number' ? trade.entryPrice.toFixed(2) : '??';
            const openPnl = typeof trade.pnl === 'number' ? trade.pnl.toFixed(2) : '0.00';

            summaryLines.push(`${escapeMarkdown(trade.bot.toUpperCase())} ${escapeMarkdown(trade.coin)} ${escapeMarkdown(trade.side)} @ ${escapeMarkdown(entry)} | Open PnL: $${escapeMarkdown(openPnl)}`);
        }
    } else {
        summaryLines.push(`\n⚪ *No Active Trades*`);
    }

    if (!hasAnyClosed && activeTrades.length === 0) {
        return '📊 *Twice Daily Summary*\nNo closed or open trades in the last 4 hours.';
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

        const since = Date.now() - 4 * 60 * 60 * 1000;
        const tradesByBot: Record<string, TradeRecord[]> = {};

        for (const bot of bots) {
            try {
                tradesByBot[bot] = await TradeTracker.getClosedTrades(bot, since);
            } catch (err) {
                logError(`[Reporter] ❌ Error fetching closed trades for ${bot}: ${err}`);
                tradesByBot[bot] = [];
            }
        }

        const activeTrades = await TradeTracker.getOpenTrades();
        const summary = buildPnLSummary(tradesByBot, activeTrades);

        await sendTelegramMessage(summary, summaryChatId);
        logInfo(`[Reporter] ✅ Sent 4-hour PnL and Active Trades summary`);
    });

    logInfo(`🕓 4-hourly PnL report scheduled`);
};
