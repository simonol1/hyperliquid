import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import { redis } from '../shared-utils/redis-client.js';
import { safeParse } from '../shared-utils/utils.js';
import { calculatePositionSize } from '../shared-utils/position-size.js';
import { orchestrateEntry } from './orchestrate-entry.js';
import { Hyperliquid } from '../sdk/index.js';
import { buildMetaMap } from '../shared-utils/coin-meta.js';
import { logInfo, logError, logDebug, logWarn } from '../shared-utils/logger.js';
import { isBotStatus, isTradeSignal, TradeSignal } from '../shared-utils/types.js';
import { scheduleGlobalHeartbeat } from '../shared-utils/scheduler.js';
import { logCycleSummary } from '../shared-utils/summary-logger.js';
import { schedulePnLSummaryEvery4Hours } from '../shared-utils/reporter.js';
import { updateBotStatus, updateBotErrorStatus } from '../shared-utils/healthcheck.js';

type BotKey = 'trend' | 'breakout' | 'reversion';

const subaccountAddress = process.env.HYPERLIQUID_SUBACCOUNT_WALLET;
if (!subaccountAddress) throw new Error(`[Orchestrator] ❌ Subaccount wallet address missing`);

const hyperliquid = new Hyperliquid({
    enableWs: true,
    privateKey: process.env.HYPERLIQUID_AGENT_PRIVATE_KEY,
    walletAddress: process.env.HYPERLIQUID_AGENT_WALLET,
    vaultAddress: subaccountAddress,
});

await hyperliquid.connect();

if (!redis.isOpen) {
    logInfo('[Orchestrator] Waiting for Redis client to be open and ready...');
    await new Promise<void>((resolve, reject) => {
        const onReady = () => {
            if (redis.isOpen) {
                redis.off('ready', onReady);
                redis.off('error', onError);
                resolve();
            } else {
                logWarn('[Orchestrator] Redis client reported ready but not open. Waiting for reconnect...');
            }
        };
        const onError = (err: Error) => {
            redis.off('ready', onReady);
            redis.off('error', onError);
            reject(new Error(`Redis client error during startup wait: ${err.message}`));
        };

        redis.on('ready', onReady);
        redis.on('error', onError);
    });
    logInfo('[Orchestrator] Redis client is open and ready.');
} else {
    logInfo('[Orchestrator] Redis client already open and ready.');
}

const COIN_META_MAP = await buildMetaMap(hyperliquid);

const CONFIG_BASE = path.resolve('./dist/config');
const trendConfig = JSON.parse(fs.readFileSync(path.join(CONFIG_BASE, 'trend-config.json'), 'utf-8'));
const breakoutConfig = JSON.parse(fs.readFileSync(path.join(CONFIG_BASE, 'breakout-config.json'), 'utf-8'));
const reversionConfig = JSON.parse(fs.readFileSync(path.join(CONFIG_BASE, 'reversion-config.json'), 'utf-8'));

const BOT_CONFIG: Record<BotKey, any> = {
    trend: trendConfig,
    breakout: breakoutConfig,
    reversion: reversionConfig,
};
const BOTS_EXPECTED: BotKey[] = ['trend', 'breakout', 'reversion'];

logInfo(`[Orchestrator] ✅ Ready with vault ${subaccountAddress}`);

schedulePnLSummaryEvery4Hours();
scheduleGlobalHeartbeat();

while (true) {
    try {
        logDebug(`[Orchestrator] Polling signals...`);
        await new Promise(res => setTimeout(res, 10_000));

        const raw = await redis.lRange('trade_signals', 0, -1);
        if (!raw?.length) continue;

        const parsed = raw.map(safeParse).filter(Boolean);
        const tradeSignals = parsed.filter(isTradeSignal);
        const completedBots = new Set(parsed.filter(isBotStatus).filter(x => x.status === 'BOT_COMPLETED').map(x => x.bot));

        logInfo(`[Orchestrator] Signals=${tradeSignals.length}, Bots done=${completedBots.size}/${BOTS_EXPECTED.length}`);
        if (completedBots.size < BOTS_EXPECTED.length) continue;
        if (!tradeSignals.length) {
            await redis.del('trade_signals');
            continue;
        }

        const signalCountsByBot = tradeSignals.reduce((acc: Record<string, number>, sig: TradeSignal) => {
            acc[sig.bot] = (acc[sig.bot] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        logInfo(`[Orchestrator] 📊 Signals by bot → ${Object.entries(signalCountsByBot)
            .map(([bot, count]) => `${bot}: ${count}`)
            .join(', ')}`);

        const goldenSignals = tradeSignals.filter(sig => sig.strength >= 90);
        if (goldenSignals.length) {
            const goldenSummary = goldenSignals.map(sig => `${sig.coin}(${sig.side}, S=${sig.strength.toFixed(1)}, ${sig.bot})`).join(', ');
            logInfo(`[Orchestrator] 🌟 Golden signals → ${goldenSummary}`);
        }

        const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
        const walletBalance = parseFloat(perpState.marginSummary.accountValue);

        const openPositions = perpState.assetPositions.filter(p => Math.abs(parseFloat(p.position.szi)) > 0).map(p => p.position.coin);
        const openOrders = (await hyperliquid.info.getUserOpenOrders(subaccountAddress)).map(o => o.coin);
        const activeCoins = new Set([...openPositions, ...openOrders]);

        const filteredSignals = tradeSignals.filter(sig => !activeCoins.has(sig.coin));
        const openCount = activeCoins.size;
        const slots = Math.max(0, parseInt(process.env.MAX_GLOBAL_CONCURRENT_TRADES || '10') - openCount);

        const strongestSignals = Array.from(
            filteredSignals.reduce((acc, sig) => {
                if (!acc.has(sig.coin) || sig.strength > acc.get(sig.coin)!.strength) acc.set(sig.coin, sig);
                return acc;
            }, new Map<string, TradeSignal>())
        ).map(([_, sig]) => sig);

        const ranked = strongestSignals.sort((a, b) => b.strength - a.strength).slice(0, slots);
        const skipped = strongestSignals.filter(s => !ranked.includes(s)).map(s => ({ coin: s.coin, reason: 'not top ranked' }));

        logCycleSummary(ranked, skipped, openCount);
        logDebug(`[Orchestrator] Executing ${ranked.length} trades → ${ranked.map(s => `${s.coin}(${s.strength.toFixed(1)})`).join(', ')}`);

        for (const signal of ranked) {
            const cfg = BOT_CONFIG[signal.bot as BotKey];
            const meta = COIN_META_MAP.get(signal.coin);
            if (!cfg || !meta) {
                logError(`[Orchestrator] ⚠️ Missing config/meta for ${signal.bot}/${signal.coin}`);
                continue;
            }
            const pos = calculatePositionSize(signal.strength, walletBalance, cfg.riskMapping);

            if (pos.capitalRiskUsd < 5) {
                logInfo(`[Orchestrator] ⚠️ Skipping ${signal.coin}: Risk $${pos.capitalRiskUsd.toFixed(2)} < $5 minimum`);
                continue;
            }

            const lev = Math.min(pos.leverage, meta.maxLeverage ?? cfg.fallbackLeverage ?? pos.leverage);

            logInfo(`[Orchestrator] 🚀 ${signal.coin} | ${signal.side} | Lev=${lev.toFixed(1)}x | Risk=$${pos.capitalRiskUsd.toFixed(2)}`);
            try {
                await orchestrateEntry(hyperliquid, signal, { ...pos, leverage: lev }, cfg, meta);
            } catch (err) {
                logError(`[Orchestrator] ❌ Failed to execute ${signal.coin}: ${(err as Error).message}`);
            }
        }

        await redis.del('trade_signals');
        logInfo(`[Orchestrator] ✅ Round complete`);
        await updateBotStatus('orchestrator');

    } catch (err) {
        logError(`[Orchestrator] ❌ Fatal loop error: ${(err as Error).stack}`);
        await updateBotErrorStatus('orchestrator', err as Error);
    }
}
