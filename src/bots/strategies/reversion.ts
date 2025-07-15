import { Hyperliquid } from '../../sdk/index';
import { stateManager } from '../../shared-utils/state-manager';
import { logInfo, logError } from '../../shared-utils/logger';
import { BotConfig } from '../config/bot-config';
import { evaluateReversionSignal } from '../../signals/reversion-signal';
import { CoinMeta } from '../../shared-utils/coin-meta';
import { pushSignal } from '../../shared-utils/push-signal';
import { hasMinimumBalance } from '../../shared-utils/check-balance';
import { sendTelegramMessage } from '../../shared-utils/telegram';
import { SkippedReason, buildTelegramCycleSummary } from '../../shared-utils/telegram-summaries';
import { TradeSignal } from '../../shared-utils/types';
import { analyseData } from '../../shared-utils/analyse-asset';

export const runReversionBot = async (
  hyperliquid: Hyperliquid,
  config: BotConfig,
  metaMap: Map<string, CoinMeta>
) => {
  logInfo(`[Reversion Bot] ✅ Started for: ${config.coins.join(', ')}`);

  while (true) {
    const loopStart = Date.now();
    logInfo(`[Reversion Bot] 🔄 New loop start`);

    try {
      const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(config.subaccountAddress);
      const realPositions = perpState.assetPositions.filter(p => Math.abs(parseFloat(p.position.szi)) > 0);

      const balanceOk = await hasMinimumBalance(hyperliquid, config.subaccountAddress);
      if (!balanceOk) logInfo(`[Reversion Bot] ⚠️ Balance low → exits only.`);

      const analyses = await Promise.all(config.coins.map(async coin => ({
        coin,
        analysis: await analyseData(hyperliquid, coin, config),
      })));

      let signals: TradeSignal[] = [];
      let skipped: SkippedReason[] = [];

      for (const { coin, analysis } of analyses) {
        if (!analysis) continue;

        const volume = analysis.volumeUsd ?? 0;
        const minVol = config.coinConfig?.[coin]?.minVolumeUsd ?? config.minVolumeUsd ?? 0;
        if (volume < minVol) {
          skipped.push({ coin, reason: `Volume $${volume} < min $${minVol}` });
          continue;
        }

        const signal = evaluateReversionSignal(coin, analysis, config);
        if (signal.type === 'HOLD') continue;

        signals.push({
          bot: config.strategy,
          coin,
          side: signal.type === 'BUY' ? 'LONG' : 'SHORT',
          atr: analysis.atr,
          entryPrice: analysis.currentPrice,
          strength: signal.strength,
          timestamp: Date.now(),
        });

        await pushSignal(signals[signals.length - 1]);
      }

      logInfo(`[Reversion Bot] 🟢 Signals sent: ${signals.length} | Active positions: ${realPositions.length}`);

      // ✅ NEW: Telegram Cycle Summary
      const cycleSummary = buildTelegramCycleSummary(signals, skipped, realPositions.length);
      const chatId = process.env.TELEGRAM_MONITOR_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
      if (!chatId) throw new Error("Missing Telegram Chat ID");
      await sendTelegramMessage(cycleSummary, chatId);

    } catch (err: any) {
      logError(`[Reversion Bot] ❌ Error: ${err.message}`);
    }

    const sleep = Math.max(0, config.loopIntervalMs - (Date.now() - loopStart));
    logInfo(`[Reversion Bot] 💤 Sleeping ${sleep}ms`);
    await new Promise(res => setTimeout(res, sleep));
  }

};
