// === Polyfill WS ===
import ws from 'ws';
globalThis.WebSocket = ws as any;

import dotenv from 'dotenv';
dotenv.config();

import { Hyperliquid } from '../sdk/index.js';
import { logInfo, logError } from '../bot-common/utils/logger.js';
import { buildMetaMap } from '../bot-common/utils/coin-meta.js';
import {
  runTrendBot, getTrendSummary, getTrendStatus,
} from './strategies/trend.js';
import {
  runBreakoutBot, getBreakoutSummary, getBreakoutStatus,
} from './strategies/breakout.js';
import {
  runReversionBot, getReversionSummary, getReversionStatus,
} from './strategies/reversion.js';
import {
  scheduleDailyReport, scheduleHeartbeat,
} from '../bot-common/utils/scheduler.js';

process.on('uncaughtException', (err) => {
  logError(`❌ Uncaught Exception: ${err}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logError(`❌ Unhandled Rejection: ${reason}`);
  process.exit(1);
});
process.on('SIGTERM', () => {
  logInfo('🔌 SIGTERM received. Exiting...');
  process.exit(0);
});
process.on('SIGINT', () => {
  logInfo('🔌 SIGINT received. Exiting...');
  process.exit(0);
});

// === Helper to init one bot client ===
async function initBotClient(vaultAddress: string) {
  const client = new Hyperliquid({
    enableWs: true,
    privateKey: process.env.HYPERLIQUID_AGENT_PRIVATE_KEY,
    walletAddress: process.env.HYPERLIQUID_WALLET,
    vaultAddress,
    testnet: process.env.HYPERLIQUID_TESTNET === 'true',
  });
  await client.connect();
  return client;
}

// === Main runner ===
const run = async () => {
  // === 1️⃣ Init all bot clients ===
  const [trendClient, breakoutClient, reversionClient] = await Promise.all([
    initBotClient(process.env.HYPERLIQUID_VAULT_TREND!),
    initBotClient(process.env.HYPERLIQUID_VAULT_BREAKOUT!),
    initBotClient(process.env.HYPERLIQUID_VAULT_REVERSION!),
  ]);

  logInfo(`✅ All bots connected with separate vaults`);

  // === 2️⃣ Get meta for each ===
  const [trendMeta, breakoutMeta, reversionMeta] = await Promise.all([
    buildMetaMap(trendClient),
    buildMetaMap(breakoutClient),
    buildMetaMap(reversionClient),
  ]);

  // === 3️⃣ Load configs ===
  const trendConfig = require('./config/trend-config.json');
  const breakoutConfig = require('./config/breakout-config.json');
  const reversionConfig = require('./config/reversion-config.json');

  // === 4️⃣ Schedule reports ===
  scheduleDailyReport('Trend Bot', getTrendSummary);
  scheduleDailyReport('Breakout Bot', getBreakoutSummary);
  scheduleDailyReport('Reversion Bot', getReversionSummary);

  scheduleHeartbeat('Trend Bot', getTrendStatus, 2);
  scheduleHeartbeat('Breakout Bot', getBreakoutStatus, 2);
  scheduleHeartbeat('Reversion Bot', getReversionStatus, 2);

  // === 5️⃣ Start bots ===
  await Promise.all([
    runTrendBot(trendClient, trendConfig, trendMeta),
    runBreakoutBot(breakoutClient, breakoutConfig, breakoutMeta),
    runReversionBot(reversionClient, reversionConfig, reversionMeta),
  ]);
};

run().catch((err) => {
  logError(`❌ Fatal bot error: ${err}`);
  process.exit(1);
});
