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
  maxLeverageMap: Record<string, number>
) => {
  logInfo(`[Reversion Bot] Started for ${config.walletAddress} | Coins: ${config.coins.join(', ')}`);

  while (true) {
    try {
      const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(config.walletAddress);
      const totalAccountUsd = parseFloat(perpState.marginSummary.accountValue);

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

      const openPositions = stateManager.getAllActivePositions();
      const openCount = Object.keys(openPositions).length;
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
          candidate.coin,
          candidate.signal,
          candidate.analysis,
          config,
          maxLeverageMap
        );
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
      logError(`[Reversion Bot] Loop error: ${err.message}`);
    }

    await new Promise((res) => setTimeout(res, config.loopIntervalMs));
  }
};
