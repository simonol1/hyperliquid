import { Hyperliquid } from '../../sdk/index';
import { analyseData } from '../../shared-utils/analyse-asset';
import { stateManager } from '../../shared-utils/state-manager';
import { logInfo, logError } from '../../shared-utils/logger';
import { BotConfig } from '../config/bot-config';
import { evaluateExit } from '../../core/evaluate-exit';
import { executeExit } from '../../core/execute-exit';
import { evaluateReversionSignal } from '../../signals/reversion-signal';
import { CoinMeta } from '../../shared-utils/coin-meta';
import { pushSignal } from '../../shared-utils/push-signal';
import { hasMinimumBalance } from '../../shared-utils/check-balance';
import { buildVirtualPositionFromLive } from '../../shared-utils/virtual-position';
import { SkippedReason } from '../../shared-utils/telegram';
import { TradeSignal } from '../../shared-utils/types';
import { updateTrailingHigh } from '../../shared-utils/trailing-stop-helpers';
import { updateTrackedPosition } from '../../shared-utils/tracked-position';

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

      const signals: TradeSignal[] = [];
      const skipped: SkippedReason[] = [];

      for (const { coin, analysis } of analyses) {
        if (!analysis) {
          skipped.push({ coin, reason: 'No analysis returned' });
          continue;
        }

        if (stateManager.isInCooldown(coin)) {
          skipped.push({ coin, reason: 'In cooldown' });
          continue;
        }

        const volume = analysis.volumeUsd ?? 0;
        const minVol = config.coinConfig?.[coin]?.minVolumeUsd ?? config.minVolumeUsd ?? 0;
        if (volume < minVol) {
          skipped.push({ coin, reason: `Volume $${volume} < min $${minVol}` });
          continue;
        }

        const signal = evaluateReversionSignal(coin, analysis, config);
        if (signal.type === 'HOLD') {
          skipped.push({ coin, reason: signal.reason || 'HOLD after reversion evaluation' });
          continue;
        }

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

      logInfo(`[Reversion Bot] 🟢 Signals sent: ${signals.length} | Positions active: ${realPositions.length}`);
      logInfo(`[Reversion Bot] 📝 Skipped=${skipped.length} → Reasons: ${skipped.map(s => `${s.coin}(${s.reason})`).join(', ') || 'None'}`);

      for (const pos of realPositions) {
        const coin = pos.position.coin;
        const szi = parseFloat(pos.position.szi);
        const entryPx = parseFloat(pos.position.entryPx);
        const virtualPos = await buildVirtualPositionFromLive(coin, szi, entryPx);
        if (!virtualPos) continue;

        const analysis = await analyseData(hyperliquid, coin, config);
        if (!analysis) continue;

        await updateTrailingHigh(virtualPos, analysis.currentPrice, updateTrackedPosition, coin);

        const exitIntent = await evaluateExit(virtualPos, analysis, config, coin);
        if (exitIntent) {
          await executeExit(hyperliquid, config.subaccountAddress, exitIntent, metaMap.get(coin));
          stateManager.clearHighWatermark(coin);
          stateManager.setCooldown(coin, 5 * 60 * 1000);
        }
      }

      await pushSignal({ bot: config.strategy, status: 'BOT_COMPLETED', timestamp: Date.now() });

    } catch (err: any) {
      logError(`[Reversion Bot] ❌ Error: ${err.message}`);
    }

    const sleep = Math.max(0, config.loopIntervalMs - (Date.now() - loopStart));
    logInfo(`[Reversion Bot] 💤 Sleeping ${sleep}ms`);
    await new Promise(res => setTimeout(res, sleep));
  }
};
