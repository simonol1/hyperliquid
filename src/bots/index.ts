// === Run WS shim immediately ===
import ws from 'ws';
// This shim is required to make the Hyperliquid SDK work in Node.js environments
// that do not support the native WebSocket API, such as when running in a test environment
// or in environments where the WebSocket API is not available globally.
globalThis.WebSocket = ws as any;

import dotenv from 'dotenv';
dotenv.config();

import { Hyperliquid } from '../sdk/index.js';

import {
  runTrendBot,
  getTrendSummary,
  getTrendStatus,
} from './strategies/trend.js';

import {
  runBreakoutBot,
  getBreakoutSummary,
  getBreakoutStatus,
} from './strategies/breakout.js';

import {
  runReversionBot,
  getReversionSummary,
  getReversionStatus,
} from './strategies/reversion.js';

import { logInfo, logError } from '../bot-common/utils/logger.js';
import {
  scheduleDailyReport,
  scheduleHeartbeat,
} from '../bot-common/utils/scheduler.js';
import { getMaxLeverageMap } from '../bot-common/utils/leverage.js';

// === Global error handlers ===
process.on('uncaughtException', (err) => {
  logError(`❌ Uncaught Exception: ${err}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logError(`❌ Unhandled Rejection: ${reason}`);
  process.exit(1);
});
process.on('SIGTERM', () => {
  logInfo('🔌 Received shutdown signal. Exiting...');
  process.exit(0);
});
process.on('SIGINT', () => {
  logInfo('🔌 Received shutdown signal. Exiting...');
  process.exit(0);
});

const run = async () => {
  const hyperliquid = new Hyperliquid({
    enableWs: true,
    privateKey: process.env.HYPERLIQUID_AGENT_PRIVATE_KEY,
    walletAddress: process.env.HYPERLIQUID_WALLET,
    testnet: process.env.HYPERLIQUID_TESTNET === 'true',
  });

  await hyperliquid.connect();
  logInfo(`✅ Connected. Running ALL bots in ONE process`);

  const maxLeverageMap = await getMaxLeverageMap(hyperliquid);
  logInfo(`✅ Loaded max leverage per pair → ${Object.keys(maxLeverageMap).length} pairs.`);

  // === Load each strategy's config ===
  const trendConfig = require('./config/trend-config.json');
  const breakoutConfig = require('./config/breakout-config.json');
  const reversionConfig = require('./config/reversion-config.json');

  // === Schedule ===
  scheduleDailyReport('Trend Bot', getTrendSummary);
  scheduleDailyReport('Breakout Bot', getBreakoutSummary);
  scheduleDailyReport('Reversion Bot', getReversionSummary);

  scheduleHeartbeat('Trend Bot', getTrendStatus, 2);
  scheduleHeartbeat('Breakout Bot', getBreakoutStatus, 2);
  scheduleHeartbeat('Reversion Bot', getReversionStatus, 2);

  // === Start all bots in parallel ===
  await Promise.all([
    runTrendBot(hyperliquid, trendConfig, maxLeverageMap),
    runBreakoutBot(hyperliquid, breakoutConfig, maxLeverageMap),
    runReversionBot(hyperliquid, reversionConfig, maxLeverageMap),
  ]);
};

run().catch((err) => {
  logError(`❌ Fatal bot error: ${err}`);
  process.exit(1);
});
