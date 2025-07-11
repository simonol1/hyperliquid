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

const BOT_TYPE = process.env.BOT_TYPE;
const vaultAddress = process.env.HYPERLIQUID_VAULT_ADDRESS;

if (!BOT_TYPE) {
  throw new Error(`BOT_TYPE not set. Please set BOT_TYPE=trend | breakout | reversion`);
}

// === Global process guards ===
process.on('uncaughtException', (err) => {
  logError(`❌ Uncaught Exception: ${err}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logError(`❌ Unhandled Rejection: ${reason}`);
  process.exit(1);
});

// === Hyperliquid client ===
const hyperliquid = new Hyperliquid({
  enableWs: true,
  privateKey: process.env.HYPERLIQUID_AGENT_PRIVATE_KEY,
  walletAddress: process.env.HYPERLIQUID_WALLET,
  vaultAddress,
});

await hyperliquid.connect();
logInfo(`✅ Connected to Hyperliquid for BOT_TYPE=${BOT_TYPE}`);

const metaMap = await buildMetaMap(hyperliquid);

// === Configs ===
const trendConfig = JSON.parse(fs.readFileSync(path.resolve('./src/bots/config/trend-config.json'), 'utf-8'));
const breakoutConfig = JSON.parse(fs.readFileSync(path.resolve('./src/bots/config/breakout-config.json'), 'utf-8'));
const reversionConfig = JSON.parse(fs.readFileSync(path.resolve('./src/bots/config/reversion-config.json'), 'utf-8'));

// === Run single strategy ===
logInfo(`🚀 Starting strategy: ${BOT_TYPE}`);

switch (BOT_TYPE) {
  case 'trend':
    await runTrendBot(hyperliquid, trendConfig, metaMap);
    break;
  case 'breakout':
    await runBreakoutBot(hyperliquid, breakoutConfig, metaMap);
    break;
  case 'reversion':
    await runReversionBot(hyperliquid, reversionConfig, metaMap);
    break;
  default:
    throw new Error(`Invalid BOT_TYPE: ${BOT_TYPE}`);
}

// === Optional heartbeat ===
scheduleHeartbeat(`Bot ${BOT_TYPE}`, () => `Running ${BOT_TYPE}`, 1);
