import { Hyperliquid } from '../../sdk/index';
import { analyseData } from '../../shared-utils/analyse-asset';
import { stateManager } from '../../shared-utils/state-manager';
import { logInfo, logError } from '../../shared-utils/logger';
import { BotConfig } from '../config/bot-config';
import { evaluateExit } from '../../core/evaluate-exit';
import { executeExit } from '../../core/execute-exit';
import { evaluateTrendSignal } from '../../signals/trend-signal';
import { CoinMeta } from '../../shared-utils/coin-meta';
import { pushSignal } from '../../shared-utils/push-signal';
import { hasMinimumBalance } from '../../shared-utils/check-balance';
import { buildVirtualPositionFromLive } from '../../shared-utils/virtual-position';
import { sendTelegramMessage, buildTelegramCycleSummary, SkippedReason } from '../../shared-utils/telegram';
import { TradeSignal } from '../../shared-utils/types';

export const runTrendBot = async (
  hyperliquid: Hyperliquid,
  config: BotConfig,
  metaMap: Map<string, CoinMeta>
) => {
  logInfo(`[Trend Bot] ✅ Started for: ${config.coins.join(', ')}`);

  while (true) {
    const loopStart = Date.now();
    logInfo(`[Trend Bot] 🔄 New loop start`);

    try {
      const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(config.subaccountAddress);
      const realPositions = perpState.assetPositions.filter(p => Math.abs(parseFloat(p.position.szi)) > 0);

      const balanceOk = await hasMinimumBalance(hyperliquid, config.subaccountAddress);
      if (!balanceOk) logInfo(`[Trend Bot] ⚠️ Balance low → exits only.`);

      const analyses = await Promise.all(config.coins.map(async coin => ({
        coin,
        analysis: await analyseData(hyperliquid, coin, config),
      })));

      const signals: TradeSignal[] = [];
      const skipped: SkippedReason[] = [];

      for (const { coin, analysis } of analyses) {
        if (!analysis) continue;

        const volume = analysis.volumeUsd ?? 0;
        const minVol = config.coinConfig?.[coin]?.minVolumeUsd ?? config.minVolumeUsd ?? 0;
        if (volume < minVol) {
          skipped.push({ coin, reason: `Volume $${volume} < min $${minVol}` });
          continue;
        }

        const signal = evaluateTrendSignal(coin, analysis, config);
        if (signal.type === 'HOLD') continue;

        const tradeSignal: TradeSignal = {
          bot: config.strategy,
          coin,
          side: signal.type === 'BUY' ? 'LONG' : 'SHORT',
          atr: analysis.atr,
          entryPrice: analysis.currentPrice,
          strength: signal.strength,
          timestamp: Date.now(),
        };

        signals.push(tradeSignal);
        await pushSignal(tradeSignal);
      }

      logInfo(`[Trend Bot] 🟢 Signals sent: ${signals.length} | Active positions: ${realPositions.length}`);

      for (const pos of realPositions) {
        const coin = pos.position.coin;
        const szi = parseFloat(pos.position.szi);
        const entryPx = parseFloat(pos.position.entryPx);

        const virtualPos = await buildVirtualPositionFromLive(coin, szi, entryPx);
        if (!virtualPos) continue;

        const analysis = await analyseData(hyperliquid, coin, config);
        if (!analysis) continue;

        const exitIntent = evaluateExit(virtualPos, analysis, config);
        if (exitIntent) {
          await executeExit(hyperliquid, config.subaccountAddress, exitIntent, metaMap.get(coin));
          stateManager.clearHighWatermark(coin);
          stateManager.setCooldown(coin, 5 * 60 * 1000);
        }
      }

      await pushSignal({ bot: config.strategy, status: 'BOT_COMPLETED', timestamp: Date.now() });

      // ✅ Telegram Cycle Summary
      const cycleSummary = buildTelegramCycleSummary(signals, skipped, realPositions.length);
      const chatId = process.env.TELEGRAM_MONITOR_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
      if (!chatId) throw new Error("Missing Telegram Chat ID");
      await sendTelegramMessage(cycleSummary, chatId);

    } catch (err: any) {
      logError(`[Trend Bot] ❌ Error: ${err.message}`);
    }

    const sleep = Math.max(0, config.loopIntervalMs - (Date.now() - loopStart));
    logInfo(`[Trend Bot] 💤 Sleeping ${sleep}ms`);
    await new Promise(res => setTimeout(res, sleep));
  }
};
