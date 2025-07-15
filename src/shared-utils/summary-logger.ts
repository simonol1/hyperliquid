// ✅ Shared Summary Logger — Aligned to TradeSignal
// shared-utils/summary-logger.ts
import { logInfo } from './logger';
import type { TradeSignal } from './types';

export type SkippedReason = {
    coin: string;
    reason: string;
};

// Clean summary aligned with TradeSignal fields
type SignalSummary = Pick<TradeSignal, 'coin' | 'side' | 'strength'>;

export const logCycleSummary = (
    signals: SignalSummary[],
    skipped: SkippedReason[],
    activePositions: number
) => {
    const sorted = signals.sort((a, b) => b.strength - a.strength);
    const top = sorted[0];
    const topText = top ? `${top.coin} (${top.side}, S=${top.strength.toFixed(1)})` : 'None';

    const skippedText = skipped.length
        ? skipped.map(s => `${s.coin}(${s.reason})`).join(', ')
        : 'None';

    logInfo(`🔎 Summary: Signals=${signals.length}, Top=${topText}, Skipped=${skipped.length} (${skippedText}), Active=${activePositions}`);
};