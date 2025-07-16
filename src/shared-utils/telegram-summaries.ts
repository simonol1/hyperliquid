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

    // Apply escapeMarkdown to all dynamic parts that are not explicitly Markdown syntax
    const topText = top ?
        `${escapeMarkdown(top.coin)} (${escapeMarkdown(top.side)}, \\*${top.strength.toFixed(1)}\\*)` : // Note the double backslash for literal '*'
        'None';

    const skippedText = skipped.length ?
        skipped.map(s => escapeMarkdown(s.coin)).join(', ') :
        'None';

    // Ensure literal asterisks for bolding are correctly handled if they are part of the original string.
    // In MarkdownV2, '*' for bolding should be preceded by a '\' if it's meant to be literal.
    // Here, we are using them for actual bolding, so they remain unescaped.
    // However, if the strength value itself could contain a '*', it would need escaping.
    // Since toFixed(1) produces numbers, it's safe.

    return [
        `*Cycle Summary*`, // This is static Markdown, no need to escape
        `Signals: ${signals.length}`, // Number is safe
        `Top: ${topText}`,
        `Skipped: ${skipped.length} (${skippedText})`,
        `Active: ${active}` // Number is safe
    ].join('\n');
};