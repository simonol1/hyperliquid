import { Hyperliquid } from '../../sdk/index';
import { analyseData, Analysis } from '../../bot-common/analyse-asset';
import { stateManager } from '../../bot-common/state-manager';
import { logInfo, logError } from '../../bot-common/utils/logger';
import { BotConfig } from '../config/bot-config';
import { initBotStats, recordTrade, buildSummary } from '../../bot-common/utils/summary';
import { evaluateExit } from '../../bot-common/evaluate-exit';
import { executeExit } from '../../bot-common/trade-executor';
import { evaluateBreakoutSignal } from '../../bot-common/breakout-signal';
import { Signal } from '../../bot-common/utils/types';
import { handleSignal } from '../../bot-common/handle-signal';
import { CoinMeta } from '../../bot-common/utils/coin-meta';

const breakoutStats = initBotStats();

export const recordBreakoutTrade = (result: 'win' | 'loss', pnl: number) => {
  recordTrade(breakoutStats, result, pnl);
};

export const getBreakoutSummary = () => buildSummary(breakoutStats);

export const getBreakoutStatus = () => {
  return `Trades so far: ${breakoutStats.totalTrades} | Wins: ${breakoutStats.wins} | Losses: ${breakoutStats.losses}`;
};

export const runBreakoutBot = async (
  hyperliquid: Hyperliquid,
  config: BotConfig,
  metaMap: Map<string, CoinMeta>
) => {
  logInfo(`[Breakout Bot] Started for ${config.vaultAddress} | Coins: ${config.coins.join(', ')}`);

  while (true) {
    try {
      const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(config.vaultAddress);
      const realPositions = perpState.assetPositions.filter(
        p => Math.abs(parseFloat(p.position.szi)) > 0
      );

      const candidates: { coin: string; signal: Signal; analysis: Analysis }[] = [];

      for (const coin of config.coins) {
        const analysis = await analyseData(hyperliquid, coin, config);
        if (!analysis) continue;

        const signal = evaluateBreakoutSignal(coin, analysis, config);
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
        logInfo(`[Breakout Bot] No top signals this loop.`);
      } else {
        logInfo(
          `[Breakout Bot] Top ${toTrade.length} signals → ${toTrade
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

      // === Check exits for real positions ===
      for (const position of realPositions) {
        const coin = position.position.coin;

        const analysis = await analyseData(hyperliquid, coin, config);
        if (!analysis) continue;

        const szi = parseFloat(position.position.szi);
        const entryPx = parseFloat(position.position.entryPx);
        const isShort = szi < 0;

        // Update high watermark for trailing stop
        stateManager.setHighWatermark(coin, analysis.currentPrice, isShort);

        const virtualPosition = {
          qty: Math.abs(szi),
          entryPrice: entryPx,
          highestPrice: stateManager.getHighWatermark(coin) ?? entryPx,
          isShort,
        };

        const exitIntent = await evaluateExit(virtualPosition, analysis, config);
        if (exitIntent) {
          await executeExit(hyperliquid, config.vaultAddress, exitIntent, metaMap.get(coin));
          stateManager.clearHighWatermark(coin);
          stateManager.setCooldown(coin, 5 * 60 * 1000);
        }
      }
    } catch (err: any) {
      logError(`[Breakout Bot] Loop error: ${err.message}`);
    }

    await new Promise((res) => setTimeout(res, config.loopIntervalMs));
  }
};
