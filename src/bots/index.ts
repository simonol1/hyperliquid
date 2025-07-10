// === Polyfill WS ===
import ws from 'ws';
globalThis.WebSocket = ws as any;

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { Hyperliquid } from '../sdk/index.js';
import { logInfo, logError } from '../shared-utils/logger.js';
import { buildMetaMap } from '../shared-utils/coin-meta.js';
import { runTrendBot } from './strategies/trend.js';
import { runBreakoutBot } from './strategies/breakout.js';
import { runReversionBot } from './strategies/reversion.js';
import { scheduleHeartbeat } from '../shared-utils/scheduler.js';

// Process safety
process.on('uncaughtException', (err) => {
  logError(`❌ Uncaught Exception: ${err}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logError(`❌ Unhandled Rejection: ${reason}`);
  process.exit(1);
});

// === 1️⃣ Create ONE Hyperliquid instance for signal fetching only ===
const hyperliquid = new Hyperliquid({
  enableWs: true,
  privateKey: process.env.HYPERLIQUID_AGENT_PRIVATE_KEY,
  walletAddress: process.env.HYPERLIQUID_WALLET,
  vaultAddress: process.env.HYPERLIQUID_VAULT_ADDRESS,
});

await hyperliquid.connect();
logInfo(`✅ Bot signal runner connected to Hyperliquid`);

// === 2️⃣ Load coin meta ===
const metaMap = await buildMetaMap(hyperliquid);

// === 3️⃣ Load config ===
const trendConfig = JSON.parse(fs.readFileSync(path.resolve('./src/bots/config/trend-config.json'), 'utf-8'));
const breakoutConfig = JSON.parse(fs.readFileSync(path.resolve('./src/bots/config/breakout-config.json'), 'utf-8'));
const reversionConfig = JSON.parse(fs.readFileSync(path.resolve('./src/bots/config/reversion-config.json'), 'utf-8'));

// === 4️⃣ Run bots in parallel ===
logInfo(`✅ Running all bot strategies: Trend, Breakout, Reversion`);

Promise.all([
  runTrendBot(hyperliquid, trendConfig, metaMap),
  runBreakoutBot(hyperliquid, breakoutConfig, metaMap),
  runReversionBot(hyperliquid, reversionConfig, metaMap),
]);

// === 5️⃣ Optionally heartbeat ===
scheduleHeartbeat('Bots', () => `Running: Trend + Breakout + Reversion`, 1);