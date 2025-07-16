// ✅ Telegram Summary Formatter

import { TradeSignal } from "./types";

export interface SignalSummary extends Pick<TradeSignal, 'coin' | 'side' | 'strength'> { }

export type SkippedReason = {
    coin: string;
    reason: string;
};

export const escapeMarkdown = (text: string) =>
    text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');


export const buildTelegramCycleSummary = (signals: SignalSummary[], skipped: SkippedReason[], active: number): string => {
    const top = signals.sort((a, b) => b.strength - a.strength)[0];

    // FIX: Apply escapeMarkdown to coin names to handle reserved characters like '-'
    const topText = top ? `${escapeMarkdown(top.coin)} (${top.side}, *${top.strength.toFixed(1)}*)` : 'None';
    const skippedText = skipped.length ? skipped.map(s => escapeMarkdown(s.coin)).join(', ') : 'None';

    return [
        `*Cycle Summary*`,
        `Signals: ${signals.length}`,
        `Top: ${topText}`,
        `Skipped: ${skipped.length} (${skippedText})`,
        `Active: ${active}`
    ].join('\n');
};