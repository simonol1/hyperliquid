import { Hyperliquid } from '../../sdk/index';
import { analyseData, Analysis } from '../../bot-common/analyse-asset';
import { evaluateSignalTrend, Signal } from '../../bot-common/signal-evaluator-trend';
import { executeExit } from '../../bot-common/trade-executor';
import { evaluateExit } from '../../bot-common/evaluate-exit';
import { stateManager } from '../../bot-common/state-manager';
import { logInfo, logError } from '../../bot-common/utils/logger';
import { BotConfig } from '../config/bot-config';
import { initBotStats, recordTrade, buildSummary } from '../../bot-common/utils/summary';
import { handleEntry } from '../../bot-common/entry-manager';

const trendStats = initBotStats();

export const recordTrendTrade = (result: 'win' | 'loss', pnl: number) => {
  recordTrade(trendStats, result, pnl);
};

export const getTrendSummary = () => buildSummary(trendStats);

export const getTrendStatus = () => {
  return `Trades so far: ${trendStats.totalTrades} | Wins: ${trendStats.wins} | Losses: ${trendStats.losses}`;
};

export const runTrendBot = async (
  hyperliquid: Hyperliquid,
  config: BotConfig,
  maxLeverageMap: Record<string, number>
) => {
  logInfo(`[Trend Bot] Started for ${config.walletAddress} | Coins: ${config.coins.join(', ')}`);

  while (true) {
    try {
      const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(config.walletAddress);
      const totalAccountUsd = parseFloat(perpState.marginSummary.accountValue);

      const candidates: { coin: string; signal: Signal; analysis: Analysis }[] = [];

      for (const coin of config.coins) {
        const analysis = await analyseData(hyperliquid, coin, config);
        if (!analysis) continue;

        const signal = evaluateSignalTrend(coin, analysis, config);
        if (signal.type === 'HOLD') continue;

        candidates.push({ coin, signal, analysis });
      }

      const goodSignals = candidates.filter(
        (c) => c.signal.strength >= config.riskMapping.minScore
      );
      goodSignals.sort((a, b) => b.signal.strength - a.signal.strength);

      const openPositions = stateManager.getAllActivePositions();
      const openCount = Object.keys(openPositions).length;
      const slots = Math.max(0, config.maxConcurrentTrades - openCount);

      const toTrade = goodSignals.slice(0, slots);

      if (toTrade.length === 0) {
        logInfo(`[Trend Bot] No top signals this loop.`);
      } else {
        logInfo(
          `[Trend Bot] Top ${toTrade.length} signals → ${toTrade
            .map((c) => `${c.coin} (${c.signal.strength.toFixed(1)})`)
            .join(', ')}`
        );
      }

      for (const candidate of toTrade) {
        const pairMaxLeverage = maxLeverageMap[candidate.coin] ?? config.leverage;

        await handleEntry({
          hyperliquid,
          coin: candidate.coin,
          signal: candidate.signal,
          analysis: candidate.analysis,
          config,
          totalAccountUsd,
          pairMaxLeverage,
        });
      }

      for (const coin of config.coins) {
        const analysis = await analyseData(hyperliquid, coin, config);
        if (!analysis) continue;

        const currentPosition = stateManager.getActivePosition(coin);
        if (!currentPosition) continue;

        const exitIntent = evaluateExit(currentPosition, analysis, config);
        if (exitIntent) {
          await executeExit(hyperliquid, coin, exitIntent);
          stateManager.setCooldown(coin, 5 * 60 * 1000);
        }
      }
    } catch (err: any) {
      logError(`[Trend Bot] Loop error: ${err.message}`);
    }

    await new Promise((res) => setTimeout(res, config.loopIntervalMs));
  }
};
