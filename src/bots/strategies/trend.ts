import { Hyperliquid } from '../../sdk/index';
import { analyseData, Analysis } from '../../shared-utils/analyse-asset';
import { stateManager } from '../../shared-utils/state-manager';
import { logInfo, logError } from '../../shared-utils/logger';
import { BotConfig } from '../config/bot-config';
import { evaluateExit } from '../../core/evaluate-exit';
import { executeExit } from '../../core/execute-exit';
import { evaluateTrendSignal } from '../../signals/trend-signal';
import { BaseSignal } from '../../shared-utils/types';
import { CoinMeta } from '../../shared-utils/coin-meta';
import { pushSignal } from '../../shared-utils/push-signal';
import { hasMinimumBalance } from '../../shared-utils/check-balance';

export const runTrendBot = async (
  hyperliquid: Hyperliquid,
  config: BotConfig,
  metaMap: Map<string, CoinMeta>
) => {
  logInfo(`[Trend Bot] ✅ Started for Coins: ${config.coins.join(', ')}`);

  let loopCounter = 0;

  while (true) {
    const loopStart = Date.now();
    loopCounter++;

    try {
      logInfo(`[Trend Bot] 🔄 Loop #${loopCounter} start`);

      const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(config.subaccountAddress);
      const realPositions = perpState.assetPositions.filter(
        p => Math.abs(parseFloat(p.position.szi)) > 0
      );

      const balanceOk = await hasMinimumBalance(hyperliquid, config.subaccountAddress);

      if (!balanceOk) {
        logInfo(`[Trend Bot] ⚠️ Balance too low for new trades. Will only run exits.`);
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

          const volume = analysis.volumeUsd ?? 0;
          const minVolume = config.minVolumeUsd ?? 0;
          if (volume < minVolume) {
            logInfo(`[Trend Bot] ⛔ Skipping ${coin}, volume ${volume.toFixed(0)} < min ${minVolume}`);
            continue;
          }

          const signal = evaluateTrendSignal(coin, analysis, config);
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
          logInfo(`[Trend Bot] ⚪ No top signals this loop.`);
        } else {
          logInfo(
            `[Trend Bot] 🎯 Top ${toTrade.length}: ${toTrade
              .map((c) => `${c.coin} (${c.signal.strength.toFixed(1)})`)
              .join(', ')}`
          );
        }

        for (const candidate of toTrade) {
          await pushSignal({
            bot: config.strategy,
            coin: candidate.coin,
            side: candidate.signal.type === 'BUY' ? 'LONG' : 'SHORT',
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
        const analysis = await analyseData(hyperliquid, coin, config);
        if (!analysis) continue;

        const szi = parseFloat(position.position.szi);
        const entryPx = parseFloat(position.position.entryPx);
        const isShort = szi < 0;

        stateManager.setHighWatermark(coin, analysis.currentPrice, isShort);

        const virtualPosition = {
          qty: Math.abs(szi),
          entryPrice: entryPx,
          highestPrice: stateManager.getHighWatermark(coin) ?? entryPx,
          isShort,
        };

        const exitIntent = evaluateExit(virtualPosition, analysis, config);
        if (exitIntent) {
          await executeExit(hyperliquid, config.subaccountAddress, exitIntent, metaMap.get(coin));
          stateManager.clearHighWatermark(coin);
          stateManager.setCooldown(coin, 5 * 60 * 1000);
        }
      }

    } catch (err: any) {
      logError(`[Trend Bot] ❌ Loop error: ${err.stack || err.message}`);
    }

    const elapsed = Date.now() - loopStart;
    const remaining = Math.max(0, config.loopIntervalMs - elapsed);
    logInfo(`[Trend Bot] ⏸ Sleeping ${remaining}ms to maintain interval.`);
    await new Promise((res) => setTimeout(res, remaining));
  }
};
