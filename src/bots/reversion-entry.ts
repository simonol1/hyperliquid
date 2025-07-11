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
import { runReversionBot } from './strategies/reversion.js';
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
logInfo(`✅ Connected to Hyperliquid (Reversion Bot)`);

const metaMap = await buildMetaMap(hyperliquid);

const CONFIG_BASE = path.resolve('./dist/config');
const reversionConfig = JSON.parse(fs.readFileSync(path.join(CONFIG_BASE, 'reversion-config.json'), 'utf-8'));

logInfo(`🚀 Starting Reversion Bot`);

await runReversionBot(hyperliquid, reversionConfig, metaMap);

scheduleHeartbeat(`Reversion Bot`, () => `Running`, 1);
