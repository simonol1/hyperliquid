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
import { isBotStatus, isTradeSignal, type TradeSignal } from '../shared-utils/types.js';
import { scheduleHourlyReport, scheduleDailyReport } from '../shared-utils/reporter.js';
import { scheduleDailyReset, scheduleHeartbeat } from '../shared-utils/scheduler.js';
import { sendTelegramMessage, buildTelegramCycleSummary } from '../shared-utils/telegram';

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

// NEW: Explicitly wait for Redis client to be truly open and ready
// This is crucial to ensure Redis operations don't fail due to a closed client.
// We wait for 'ready' AND ensure it's 'isOpen'.
if (!redis.isOpen) { // Check if it's not already open
    logInfo('[Orchestrator] Waiting for Redis client to be open and ready...');
    await new Promise<void>((resolve, reject) => {
        const onReady = () => {
            if (redis.isOpen) { // Confirm it's actually open when ready
                redis.off('ready', onReady);
                redis.off('error', onError); // Remove error listener if successful
                resolve();
            } else {
                // This case should ideally not happen if 'ready' implies 'isOpen',
                // but adding a small delay or more robust check might be needed if it does.
                logWarn('[Orchestrator] Redis client reported ready but not open. Waiting for reconnect...');
            }
        };
        const onError = (err: Error) => {
            // If an error occurs during the waiting period, reject the promise
            redis.off('ready', onReady);
            redis.off('error', onError);
            reject(new Error(`Redis client error during startup wait: ${err.message}`));
        };

        redis.on('ready', onReady);
        redis.on('error', onError); // Listen for errors during the wait
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

scheduleHourlyReport();
scheduleDailyReport();
scheduleDailyReset();
scheduleHeartbeat('Orchestrator', () => 'Running fine', 1);

while (true) {
    logDebug(`[Orchestrator] Polling for signals...`);
    await new Promise(res => setTimeout(res, 10_000));

    const raw = await redis.lRange('trade_signals', 0, -1);
    if (!raw?.length) {
        logDebug(`[Orchestrator] No signals → loop again`);
        continue;
    }

    const all = raw.map(safeParse).filter(Boolean);
    const tradeSignals: TradeSignal[] = [];
    const completedBots = new Set<BotKey>();

    for (const s of all) {
        if (isTradeSignal(s)) tradeSignals.push(s);
        else if (isBotStatus(s) && s.status === 'BOT_COMPLETED') completedBots.add(s.bot as BotKey);
    }

    logInfo(`[Orchestrator] 📥 Signals Received: ${tradeSignals.length} (${completedBots.size}/${BOTS_EXPECTED.length} bots done)`);

    if (completedBots.size < BOTS_EXPECTED.length) {
        logDebug(`[Orchestrator] Not all bots done → waiting`);
        continue;
    }

    if (!tradeSignals.length) {
        logInfo(`[Orchestrator] ✅ No trade signals → clearing queue`);
        await redis.del('trade_signals');
        continue;
    }

    const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
    const realPositions = perpState.assetPositions.filter(p => Math.abs(parseFloat(p.position.szi)) > 0);
    const openOrders = await hyperliquid.info.getUserOpenOrders(subaccountAddress);
    const walletBalance = parseFloat(perpState.withdrawable);

    const activeCoins = new Set([
        ...realPositions.map(p => p.position.coin),
        ...openOrders.map(o => o.coin),
    ]);

    const openCount = activeCoins.size;
    const maxConcurrentTrades = parseInt(process.env.MAX_GLOBAL_CONCURRENT_TRADES || '6', 10);

    const slots = Math.max(0, maxConcurrentTrades - openCount);

    // Group by coin, keep strongest per coin
    const strongestSignals = Array.from(
        tradeSignals.reduce((acc, sig) => {
            if (!acc.has(sig.coin) || sig.strength > acc.get(sig.coin)!.strength) {
                acc.set(sig.coin, sig);
            }
            return acc;
        }, new Map<string, typeof tradeSignals[0]>())
    ).map(([_, sig]) => sig);

    // Sort strongest unique signals
    const ranked = strongestSignals.sort((a, b) => b.strength - a.strength).slice(0, slots);

    // Keep track of skipped signals
    const skipped = strongestSignals
        .filter(sig => !ranked.find(r => r.coin === sig.coin))
        .map(sig => ({ coin: sig.coin, reason: 'not top ranked' }));


    if (!ranked.length) {
        const cycleSummary = buildTelegramCycleSummary([], skipped, openCount);
        const chatId = process.env.TELEGRAM_MONITOR_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
        if (chatId) await sendTelegramMessage(cycleSummary, chatId);

        logInfo(`[Orchestrator] ⚪ No signals selected → end of loop`);
        await redis.del('trade_signals');
        continue;
    }

    logInfo(`[Orchestrator] ✅ Executing ${ranked.length} unique signals → ${ranked.map(s => `${s.coin}(${s.strength.toFixed(1)})`).join(', ')}`);

    for (const signal of ranked) {
        const botCfg = BOT_CONFIG[signal.bot as BotKey];
        const coinMeta = COIN_META_MAP.get(signal.coin);
        if (!botCfg || !coinMeta) {
            logError(`[Orchestrator] ⚠️ Missing config/meta for ${signal.bot}/${signal.coin}`);
            continue;
        }

        const posMeta = calculatePositionSize(signal.strength, walletBalance, botCfg.riskMapping);
        const maxLev = coinMeta.maxLeverage ?? botCfg.fallbackLeverage ?? posMeta.leverage;
        const finalLev = Math.min(posMeta.leverage, maxLev);

        logInfo(`[Orchestrator] 🚀 ${signal.coin} | ${signal.side} | Lev=${finalLev.toFixed(1)}x | Risk=$${posMeta.capitalRiskUsd.toFixed(2)}`);

        try {
            await orchestrateEntry(hyperliquid, signal, { ...posMeta, leverage: finalLev }, botCfg, coinMeta);
        } catch (err: any) {
            logError(`[Orchestrator] ❌ Failed to execute ${signal.coin}: ${err.message}`);
        }
    }

    const cycleSummary = buildTelegramCycleSummary(ranked, skipped, openCount);
    const chatId = process.env.TELEGRAM_MONITOR_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    if (chatId) await sendTelegramMessage(cycleSummary, chatId);

    await redis.del('trade_signals');
    logInfo(`[Orchestrator] ✅ Round complete`);
}
