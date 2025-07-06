export interface Signal {
    type: 'BUY' | 'SELL' | 'HOLD';
    strength: number;
}