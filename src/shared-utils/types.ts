
export interface BaseSignal {
    type: 'BUY' | 'SELL' | 'HOLD';
    strength: number;
}

export interface TradeSignal {
    bot: string;
    coin: string;
    side: string;
    atr: number;
    entryPrice: number;
    strength: number;
    timestamp: number;
}

export interface BotStatusMessage {
    bot: string;
    status: 'BOT_COMPLETED';
    timestamp: number;
}


export const isTradeSignal = (x: unknown): x is TradeSignal => {
    return (
        typeof x === 'object' &&
        x !== null &&
        'coin' in x &&
        'side' in x &&
        'strength' in x &&
        'timestamp' in x
    );
}

export const isBotStatus = (x: unknown): x is BotStatusMessage => {
    return (
        typeof x === 'object' &&
        x !== null &&
        'bot' in x &&
        'status' in x
    );
}

export type SignalMessage = TradeSignal | BotStatusMessage;