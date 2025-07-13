import { Hyperliquid } from '../../sdk/index';
import { analyseData, Analysis } from '../../shared-utils/analyse-asset';
import { stateManager } from '../../shared-utils/state-manager';
import { logInfo, logError } from '../../shared-utils/logger';
import { BotConfig } from '../config/bot-config';
import { evaluateExit } from '../../core/evaluate-exit';
import { executeExit } from '../../core/execute-exit';
import { evaluateBreakoutSignal } from '../../signals/breakout-signal';
import { BaseSignal } from '../../shared-utils/types';
import { CoinMeta } from '../../shared-utils/coin-meta';
import { pushSignal } from '../../shared-utils/push-signal';
import { hasMinimumBalance } from '../../shared-utils/check-balance';
import { buildVirtualPositionFromLive } from '../../shared-utils/virtual-position';

export const runBreakoutBot = async (
  hyperliquid: Hyperliquid,
  config: BotConfig,
  metaMap: Map<string, CoinMeta>
) => {
  logInfo(`[Breakout Bot] ✅ Started for Coins: ${config.coins.join(', ')}`);

  let loopCounter = 0;

  while (true) {
    const loopStart = Date.now();
    loopCounter++;

    try {
      logInfo(`[Breakout Bot] 🔄 Loop #${loopCounter} start`);

      const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(config.subaccountAddress);
      const realPositions = perpState.assetPositions.filter(
        p => Math.abs(parseFloat(p.position.szi)) > 0
      );

      const balanceOk = await hasMinimumBalance(hyperliquid, config.subaccountAddress);

      if (!balanceOk) {
        logInfo(`[Breakout Bot] ⚠️ Balance too low for new trades. Will only run exits.`);
      } else {
        const candidates: { coin: string; signal: BaseSignal; analysis: Analysis }[] = [];

        const analyses = await Promise.all(
          config.coins.map(async (coin) => {
            const analysis = await analyseData(hyperliquid, coin, config);
            return { coin, analysis };
          })
        );

        for (const { coin, analysis } of analyses) {
          if (!analysis) continue;

          const currentVolume = analysis.volumeUsd ?? 0;
          const overrides = config.coinConfig?.[coin];
          const minVolumeRequired = overrides?.minVolumeUsd ?? config.minVolumeUsd ?? 0;

          if (currentVolume < minVolumeRequired) {
            logInfo(`[Breakout Bot] ⛔ Skipping ${coin}, volume $${currentVolume.toFixed(0)} < min $${minVolumeRequired}`);
            continue;
          }

          const signal = evaluateBreakoutSignal(coin, analysis, config);
          if (signal.type === 'HOLD') continue;

          candidates.push({ coin, signal, analysis });
        }

        const goodSignals = candidates
          .filter((c) => c.signal.strength >= config.riskMapping.minScore)
          .sort((a, b) => b.signal.strength - a.signal.strength);

        const openCount = realPositions.length;
        const slots = Math.max(0, config.maxConcurrentTrades - openCount);
        const toTrade = goodSignals.slice(0, slots);

        if (toTrade.length === 0) {
          logInfo(`[Breakout Bot] ⚪ No top signals this loop.`);
        } else {
          logInfo(
            `[Breakout Bot] 🎯 Top ${toTrade.length}: ${toTrade
              .map((c) => `${c.coin} (${c.signal.strength.toFixed(1)})`)
              .join(', ')}`
          );
        }

        for (const candidate of toTrade) {
          await pushSignal({
            bot: config.strategy,
            coin: candidate.coin,
            side: candidate.signal.type === 'BUY' ? 'LONG' : 'SHORT',
            atr: candidate.analysis.atr,
            entryPrice: candidate.analysis.currentPrice,
            strength: candidate.signal.strength,
            timestamp: Date.now(),
          });
        }
      }

      await pushSignal({
        bot: config.strategy,
        status: 'BOT_DONE',
        timestamp: Date.now(),
      });

      for (const position of realPositions) {
        const coin = position.position.coin;
        const szi = parseFloat(position.position.szi);
        const entryPx = parseFloat(position.position.entryPx);

        const virtualPosition = await buildVirtualPositionFromLive(coin, szi, entryPx);
        if (!virtualPosition) continue;

        const analysis = await analyseData(hyperliquid, coin, config);
        if (!analysis) continue;

        const exitIntent = evaluateExit(virtualPosition, analysis, config);
        if (exitIntent) {
          await executeExit(hyperliquid, config.subaccountAddress, exitIntent, metaMap.get(coin));
          stateManager.clearHighWatermark(coin);
          stateManager.setCooldown(coin, 5 * 60 * 1000);
        }
      }

    } catch (err: any) {
      logError(`[Breakout Bot] ❌ Loop error: ${err.stack || err.message}`);
    }

    const elapsed = Date.now() - loopStart;
    const remaining = Math.max(0, config.loopIntervalMs - elapsed);

    logInfo(`[Breakout Bot] ⏸ Sleeping ${remaining}ms to maintain interval.`);

    await new Promise((res) => setTimeout(res, remaining));
  }
};
