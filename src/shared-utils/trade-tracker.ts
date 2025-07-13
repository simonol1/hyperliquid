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
    qty?: number;         // final qty used
    leverage?: number;    // final leverage used
    vault: string;
    openedAt?: number;
    closedAt?: number;
    exitPrice?: number;
    pnl?: number;
    rawSignal?: any; // optional full signal payload for debugging
    takeProfitTarget?: number;
    trailingStopTarget?: number;
}

export const TradeTracker = {
    async pushSignal(signal: {
        bot: string,
        coin: string,
        side: 'LONG' | 'SHORT',
        entryPrice: number,
        strength: number,
        vault: string,
        rawSignal?: any
    }): Promise<TradeRecord> {
        const trade: TradeRecord = {
            id: uuidv4(),
            bot: signal.bot,
            coin: signal.coin,
            side: signal.side,
            signalStrength: signal.strength,
            status: 'pushed',
            entryPrice: signal.entryPrice,
            vault: signal.vault,
            rawSignal: signal.rawSignal ?? {},
        };
        await redis.set(`trade:${trade.id}`, JSON.stringify(trade));
        return trade;
    },

    async getAllTradeKeys() {
        return await redis.keys('trade:*');
    },

    async markConfirmed(id: string, qty: number, leverage: number, extras?: Partial<TradeRecord>) {
        const raw = await redis.get(`trade:${id}`);
        if (!raw) throw new Error(`TradeTracker: No trade with id=${id}`);
        const trade = JSON.parse(raw);
        trade.status = 'confirmed';
        trade.qty = qty;
        trade.leverage = leverage;
        trade.openedAt = Date.now();

        if (extras) {
            Object.assign(trade, extras);
        }

        await redis.set(`trade:${id}`, JSON.stringify(trade));
    },

    async markFailed(id: string) {
        const raw = await redis.get(`trade:${id}`);
        if (!raw) return; // fail silently
        const trade = JSON.parse(raw);
        trade.status = 'failed';
        await redis.set(`trade:${id}`, JSON.stringify(trade));
    },

    async markClosed(id: string, exitPrice: number, pnl: number) {
        const raw = await redis.get(`trade:${id}`);
        if (!raw) throw new Error(`TradeTracker: No trade with id=${id}`);
        const trade = JSON.parse(raw);
        trade.status = 'closed';
        trade.exitPrice = exitPrice;
        trade.pnl = pnl;
        trade.closedAt = Date.now();
        await redis.set(`trade:${id}`, JSON.stringify(trade));
    },

    async getOpenTrades() {
        const keys = await redis.keys('trade:*');
        const raw = await Promise.all(keys.map(k => redis.get(k)));
        return raw
            .filter((x): x is string => !!x)
            .map((x) => JSON.parse(x))
            .filter((t: TradeRecord) => t.status === 'confirmed');
    }
}
