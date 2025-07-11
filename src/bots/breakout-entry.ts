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
import { runBreakoutBot } from './strategies/breakout.js';
import { scheduleHeartbeat } from '../shared-utils/scheduler.js';

const vaultAddress = process.env.HYPERLIQUID_VAULT_ADDRESS;

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
    walletAddress: process.env.HYPERLIQUID_WALLET,
    vaultAddress,
});

await hyperliquid.connect();
logInfo(`✅ Connected to Hyperliquid (Breakout Bot)`);

const metaMap = await buildMetaMap(hyperliquid);
const breakoutConfig = JSON.parse(fs.readFileSync(path.resolve('./src/bots/config/breakout-config.json'), 'utf-8'));

logInfo(`🚀 Starting Breakout Bot`);
await runBreakoutBot(hyperliquid, breakoutConfig, metaMap);

scheduleHeartbeat(`Breakout Bot`, () => `Running`, 1);
