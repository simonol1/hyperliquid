import { redis } from './redis-client.js';
import { v4 as uuidv4 } from 'uuid';
import { logDebug, logError, logWarn } from './logger.js'; // Ensure logger imports are correct

export interface TradeRecord {
    id: string;
    bot: string;
    coin: string;
    side: 'LONG' | 'SHORT';
    signalStrength: number;
    status: 'pushed' | 'confirmed' | 'closed' | 'failed';
    entryPrice: number;
    qty?: number;
    leverage?: number;
    vault: string;
    openedAt?: number;
    closedAt?: number;
    exitPrice?: number;
    pnl?: number;
    rawSignal?: any;
    takeProfitTarget?: number;
    // FIX: Added missing properties from markConfirmed in executeEntry
    trailingStopTarget?: number;
    trailingStopActive?: boolean; // Added
    trailingStopPct?: number;    // Added
    highestPrice?: number;       // Added
}

const TRADE_PREFIX = 'trade:';

const parse = (json: string): TradeRecord | null => {
    try {
        return JSON.parse(json);
    } catch (e) {
        logError(`[TradeTracker] Error parsing JSON: ${e}. Raw JSON: ${json}`);
        return null;
    }
};

export const TradeTracker = {
    async pushSignal({
        bot, coin, side, entryPrice, strength, vault, rawSignal
    }: {
        bot: string;
        coin: string;
        side: 'LONG' | 'SHORT';
        entryPrice: number;
        strength: number;
        vault: string;
        rawSignal?: any;
    }): Promise<TradeRecord> {
        const trade: TradeRecord = {
            id: uuidv4(),
            bot,
            coin,
            side: side as TradeRecord['side'], // FIX: Type assertion for 'side'
            signalStrength: strength,
            status: 'pushed',
            entryPrice,
            vault,
            rawSignal: rawSignal ?? {},
        };
        logDebug(`[TradeTracker] Pushing signal for ${trade.coin} with ID: ${trade.id}`);
        await redis.set(`${TRADE_PREFIX}${trade.id}`, JSON.stringify(trade));
        return trade;
    },

    async getAllTrades(): Promise<TradeRecord[]> {
        logDebug(`[TradeTracker] Fetching all trade keys.`);
        const keys = await redis.keys(`${TRADE_PREFIX}*`);
        logDebug(`[TradeTracker] Found ${keys.length} trade keys.`);
        const raw = await Promise.all(keys.map(k => redis.get(k)));
        return raw
            .filter((x): x is string => {
                if (!x) logDebug(`[TradeTracker] Filtered out null/undefined raw trade data.`);
                return !!x;
            })
            .map(parse)
            .filter((t): t is TradeRecord => {
                if (t === null) logWarn(`[TradeTracker] Filtered out null parsed trade record.`);
                return t !== null;
            });
    },

    async getOpenTrades(): Promise<TradeRecord[]> {
        logDebug(`[TradeTracker] Getting open trades.`);
        const all = await this.getAllTrades();
        const open = all.filter(t => t.status === 'confirmed');
        logDebug(`[TradeTracker] Found ${open.length} open trades.`);
        return open;
    },

    async getClosedTrades(bot?: string, since?: number): Promise<TradeRecord[]> {
        logDebug(`[TradeTracker] Getting closed trades for bot: ${bot || 'all'}, since: ${since ? new Date(since).toISOString() : 'beginning'}.`);
        const all = await this.getAllTrades();
        const closed = all.filter(t =>
            t.status === 'closed' &&
            (!bot || t.bot === bot) &&
            (!since || (t.closedAt ?? 0) >= since)
        );
        logDebug(`[TradeTracker] Found ${closed.length} closed trades.`);
        return closed;
    },

    async markConfirmed(id: string, qty: number, leverage: number, updates?: Partial<TradeRecord>) {
        logDebug(`[TradeTracker] Marking trade ${id} as confirmed.`);
        const raw = await redis.get(`${TRADE_PREFIX}${id}`);
        if (!raw) {
            logError(`[TradeTracker] markConfirmed: No trade with id=${id} found.`);
            throw new Error(`TradeTracker: No trade with id=${id}`);
        }

        const trade = parse(raw);
        if (!trade) {
            logError(`[TradeTracker] markConfirmed: Invalid trade JSON for id=${id}. Raw: ${raw}`);
            throw new Error(`TradeTracker: Invalid trade JSON for id=${id}`);
        }

        Object.assign(trade, {
            status: 'confirmed',
            qty,
            leverage,
            openedAt: Date.now(),
            ...(updates || {})
        });
        logDebug(`[TradeTracker] Updated trade ${id} to confirmed status.`);
        await redis.set(`${TRADE_PREFIX}${id}`, JSON.stringify(trade));
    },

    async markClosed(id: string, exitPrice: number, pnl: number) {
        logDebug(`[TradeTracker] Marking trade ${id} as closed.`);
        const raw = await redis.get(`${TRADE_PREFIX}${id}`);
        if (!raw) {
            logWarn(`[TradeTracker] markClosed: No trade with id=${id} found, cannot mark closed.`);
            return; // Don't throw if not found, it might have been cleaned up elsewhere
        }

        const trade = parse(raw);
        if (!trade) {
            logError(`[TradeTracker] markClosed: Invalid trade JSON for id=${id}. Raw: ${raw}`);
            return; // Don't throw if invalid, just log
        }

        Object.assign(trade, {
            status: 'closed',
            exitPrice,
            pnl,
            closedAt: Date.now(),
        });
        logDebug(`[TradeTracker] Updated trade ${id} to closed status.`);
        await redis.set(`${TRADE_PREFIX}${id}`, JSON.stringify(trade));
    },

    async markFailed(id: string) {
        logDebug(`[TradeTracker] Marking trade ${id} as failed.`);
        const raw = await redis.get(`${TRADE_PREFIX}${id}`);
        if (!raw) {
            logWarn(`[TradeTracker] markFailed: No trade with id=${id} found, cannot mark failed.`);
            return;
        }

        const trade = parse(raw);
        if (!trade) {
            logError(`[TradeTracker] markFailed: Invalid trade JSON for id=${id}. Raw: ${raw}`);
            return;
        }

        trade.status = 'failed';
        logDebug(`[TradeTracker] Updated trade ${id} to failed status.`);
        await redis.set(`${TRADE_PREFIX}${id}`, JSON.stringify(trade));
    }
};
