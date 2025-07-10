import { TradeTracker } from './trade-tracker';
import { sendTelegramMessage } from './telegram.js';
import { logInfo, logError, logDebug } from './logger.js';
import { redis } from './redis-client.js';

const bots = ['trend', 'breakout', 'reversion'] as const;

const buildTrackedSummary = async (bot: string): Promise<string> => {
    const keys = await redis.keys('trade:*');
    const raw = await Promise.all(keys.map(k => redis.get(k)));

    const closedTrades = raw
        .filter((x): x is string => !!x)
        .map(x => JSON.parse(x))
        .filter((t: any) => t.status === 'closed' && t.bot === bot);

    const totalTrades = closedTrades.length;
    const wins = closedTrades.filter((t: any) => t.pnl > 0).length;
    const losses = totalTrades - wins;
    const netPnl = closedTrades.reduce((acc, t) => acc + (t.pnl ?? 0), 0);

    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0';

    return `
        📊 *${bot.toUpperCase()} Bot Daily PnL*
        Trades Closed: ${totalTrades}
        Wins: ${wins}
        Losses: ${losses}
        Win Rate: ${winRate}%
        Net PnL: $${netPnl.toFixed(2)}
    `.trim();
};

const runDailyReport = async () => {
    for (const bot of bots) {
        try {
            const summary = await buildTrackedSummary(bot);
            await sendTelegramMessage(summary);
            logInfo(`[Reporter] ✅ Sent daily for ${bot}`);
        } catch (err) {
            logError(`[Reporter] ❌ Failed for ${bot}: ${err}`);
        }
    }
};

runDailyReport()
    .then(() => logDebug('[Reporter] ✅ All done!'))
    .catch(err => logError(`[Reporter] ❌ Fatal: ${err}`));
