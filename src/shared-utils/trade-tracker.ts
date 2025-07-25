import { redis } from './redis-client.js';
import { v4 as uuidv4 } from 'uuid';

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
    trailingStopTarget?: number;
}

const TRADE_PREFIX = 'trade:';

const parse = (json: string): TradeRecord | null => {
    try {
        return JSON.parse(json);
    } catch {
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
            side,
            signalStrength: strength,
            status: 'pushed',
            entryPrice,
            vault,
            rawSignal: rawSignal ?? {},
        };

        await redis.set(`${TRADE_PREFIX}${trade.id}`, JSON.stringify(trade));
        return trade;
    },

    async getAllTrades(): Promise<TradeRecord[]> {
        const keys = await redis.keys(`${TRADE_PREFIX}*`);
        const raw = await Promise.all(keys.map(k => redis.get(k)));
        return raw
            .filter((x): x is string => !!x)
            .map(parse)
            .filter((t): t is TradeRecord => t !== null);
    },

    async getOpenTrades(): Promise<TradeRecord[]> {
        const all = await this.getAllTrades();
        return all.filter(t => t.status === 'confirmed');
    },

    async getClosedTrades(bot?: string, since?: number): Promise<TradeRecord[]> {
        const all = await this.getAllTrades();
        return all.filter(t =>
            t.status === 'closed' &&
            (!bot || t.bot === bot) &&
            (!since || (t.closedAt ?? 0) >= since)
        );
    },

    async markConfirmed(id: string, qty: number, leverage: number, updates?: Partial<TradeRecord>) {
        const raw = await redis.get(`${TRADE_PREFIX}${id}`);
        if (!raw) throw new Error(`TradeTracker: No trade with id=${id}`);

        const trade = parse(raw);
        if (!trade) throw new Error(`TradeTracker: Invalid trade JSON for id=${id}`);

        Object.assign(trade, {
            status: 'confirmed',
            qty,
            leverage,
            openedAt: Date.now(),
            ...(updates || {})
        });

        await redis.set(`${TRADE_PREFIX}${id}`, JSON.stringify(trade));
    },

    async markClosed(id: string, exitPrice: number, pnl: number) {
        const raw = await redis.get(`${TRADE_PREFIX}${id}`);
        if (!raw) throw new Error(`TradeTracker: No trade with id=${id}`);

        const trade = parse(raw);
        if (!trade) throw new Error(`TradeTracker: Invalid trade JSON for id=${id}`);

        Object.assign(trade, {
            status: 'closed',
            exitPrice,
            pnl,
            closedAt: Date.now(),
        });

        await redis.set(`${TRADE_PREFIX}${id}`, JSON.stringify(trade));
    },

    async markFailed(id: string) {
        const raw = await redis.get(`${TRADE_PREFIX}${id}`);
        if (!raw) return;

        const trade = parse(raw);
        if (!trade) return;

        trade.status = 'failed';
        await redis.set(`${TRADE_PREFIX}${id}`, JSON.stringify(trade));
    }
};
