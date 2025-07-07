import { Hyperliquid } from '../../sdk/index';
import { analyseData, Analysis } from '../../bot-common/analyse-asset';
import { evaluateReversionSignal } from '../../bot-common/reversion-signal';
import { executeExit } from '../../bot-common/trade-executor';
import { evaluateExit } from '../../bot-common/evaluate-exit';
import { stateManager } from '../../bot-common/state-manager';
import { logInfo, logError } from '../../bot-common/utils/logger';
import { BotConfig } from '../config/bot-config';
import { initBotStats, recordTrade, buildSummary } from '../../bot-common/utils/summary';
import { Signal } from '../../bot-common/utils/types';
import { handleSignal } from '../../bot-common/handle-signal';
import { CoinMeta } from '../../bot-common/utils/coin-meta';

const reversionStats = initBotStats();

export const recordReversionTrade = (result: 'win' | 'loss', pnl: number) => {
  recordTrade(reversionStats, result, pnl);
};

export const getReversionSummary = () => buildSummary(reversionStats);

export const getReversionStatus = () => {
  return `Trades so far: ${reversionStats.totalTrades} | Wins: ${reversionStats.wins} | Losses: ${reversionStats.losses}`;
};

export const runReversionBot = async (
  hyperliquid: Hyperliquid,
  config: BotConfig,
  metaMap: Map<string, CoinMeta>
) => {
  logInfo(`[Reversion Bot] Started for ${config.vaultAddress} | Coins: ${config.coins.join(', ')}`);

  while (true) {
    try {
      const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(config.vaultAddress);
      const realPositions = perpState.assetPositions.filter(p => Math.abs(parseFloat(p.position.szi)) > 0);

      const candidates: { coin: string; signal: Signal; analysis: Analysis }[] = [];

      for (const coin of config.coins) {
        const analysis = await analyseData(hyperliquid, coin, config);
        if (!analysis) continue;

        const signal = evaluateReversionSignal(coin, analysis, config);
        if (signal.type === 'HOLD') continue;

        candidates.push({ coin, signal, analysis });
      }

      const goodSignals = candidates.filter(
        (c) => c.signal.strength >= config.riskMapping.minScore
      );
      goodSignals.sort((a, b) => b.signal.strength - a.signal.strength);

      const openCount = realPositions.length;
      const slots = Math.max(0, config.maxConcurrentTrades - openCount);
      const toTrade = goodSignals.slice(0, slots);

      if (toTrade.length === 0) {
        logInfo(`[Reversion Bot] No top signals this loop.`);
      } else {
        logInfo(
          `[Reversion Bot] Top ${toTrade.length} signals → ${toTrade
            .map((c) => `${c.coin} (${c.signal.strength.toFixed(1)})`)
            .join(', ')}`
        );
      }

      for (const candidate of toTrade) {
        await handleSignal(
          hyperliquid,
          candidate.signal,
          candidate.analysis,
          config,
          metaMap.get(candidate.coin)
        );
      }

      // === Exits ===
      for (const position of realPositions) {
        const coin = position.position.coin;
        const analysis = await analyseData(hyperliquid, coin, config);
        if (!analysis) continue;

        const virtualPosition = {
          qty: Math.abs(parseFloat(position.position.szi)),
          entryPrice: parseFloat(position.position.entryPx),
          highestPrice: parseFloat(position.position.entryPx),
          isShort: parseFloat(position.position.szi) < 0,
        };

        const exitIntent = await evaluateExit(virtualPosition, analysis, config);
        if (exitIntent) {
          await executeExit(hyperliquid, config.vaultAddress, exitIntent, metaMap.get(coin));
          stateManager.clearHighWatermark(coin);
          stateManager.setCooldown(coin, 5 * 60 * 1000);
        }
      }
    } catch (err: any) {
      logError(`[Reversion Bot] Loop error: ${err.message}`);
    }

    await new Promise((res) => setTimeout(res, config.loopIntervalMs));
  }
};
