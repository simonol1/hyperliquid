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
import { scheduleHeartbeat } from '../shared-utils/scheduler.js';

const vaultAddress = process.env.HYPERLIQUID_SUBACCOUNT_WALLET;

process.on('uncaughtException', (err) => {
    logError(`❌ Uncaught Exception: ${err}`);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    logError(`❌ Unhandled Rejection: ${reason}`);
    process.exit(1);
});

const hyperliquid = new Hyperliquid({
    enableWs: true,
    privateKey: process.env.HYPERLIQUID_AGENT_PRIVATE_KEY,
    walletAddress: process.env.HYPERLIQUID_AGENT_WALLET,
    vaultAddress,
});

await hyperliquid.connect();
logInfo(`✅ Connected to Hyperliquid (Trend Bot)`);

const metaMap = await buildMetaMap(hyperliquid);

const CONFIG_BASE = path.resolve('./dist/config');
const trendConfig = JSON.parse(fs.readFileSync(path.join(CONFIG_BASE, 'trend-config.json'), 'utf-8'));

logInfo(`🚀 Starting Trend Bot`);

await runTrendBot(hyperliquid, trendConfig, metaMap);

scheduleHeartbeat(`Trend Bot`, () => `Running`, 1);
