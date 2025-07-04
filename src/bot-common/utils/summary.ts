// src/utils/summary.ts

export interface BotStats {
    totalTrades: number;
    wins: number;
    losses: number;
    totalPnl: number;
}

export function initBotStats(): BotStats {
    return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
    };
}

export const recordTrade = (stats: BotStats, result: 'win' | 'loss', pnl: number) => {
    stats.totalTrades++;
    if (result === 'win') stats.wins++;
    else stats.losses++;
    stats.totalPnl += pnl;
}

export const buildSummary = (stats: BotStats): string => {
    const winRate = stats.totalTrades > 0
        ? ((stats.wins / stats.totalTrades) * 100).toFixed(1)
        : '0';

    return `
Trades: ${stats.totalTrades}
Wins: ${stats.wins}
Losses: ${stats.losses}
Win Rate: ${winRate}%
PnL: $${stats.totalPnl.toFixed(2)}
`;
}
