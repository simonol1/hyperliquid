// ✅ Telegram Summary Formatter

import { TradeSignal } from "./types";

export interface SignalSummary extends Pick<TradeSignal, 'coin' | 'side' | 'strength'> { }

export type SkippedReason = {
    coin: string;
    reason: string;
};

export const buildTelegramCycleSummary = (signals: SignalSummary[], skipped: SkippedReason[], active: number): string => {
    const top = signals.sort((a, b) => b.strength - a.strength)[0];
    const topText = top ? `${top.coin} (${top.side}, *${top.strength.toFixed(1)}*)` : 'None';
    const skippedText = skipped.length ? skipped.map(s => `${s.coin}`).join(', ') : 'None';

    return [
        `*Cycle Summary*`,
        `Signals: ${signals.length}`,
        `Top: ${topText}`,
        `Skipped: ${skipped.length} (${skippedText})`,
        `Active: ${active}`
    ].join('\n');
};