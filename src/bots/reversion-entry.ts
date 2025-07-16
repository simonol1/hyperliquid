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
import { redis } from '../shared-utils/redis-client.js';

const subaccountAddress = process.env.HYPERLIQUID_SUBACCOUNT_WALLET;

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
    vaultAddress: subaccountAddress,
});

await hyperliquid.connect();
logInfo(`✅ [Reversion Bot] Connected to Hyperliquid`);

// NEW: Explicitly wait for Redis client to be ready
// This is crucial to ensure Redis operations don't fail due to a closed client.
// The 'ready' event listener in redis-client.js will log success.
if (!redis.isReady) {
    logInfo('[Reversion Bot] Waiting for Redis client to be ready...');
    await new Promise<void>((resolve) => {
        const onReady = () => {
            redis.off('ready', onReady);
            resolve();
        };
        redis.on('ready', onReady);
    });
    logInfo('[Reversion Bot] Redis client is ready.');
} else {
    logInfo('[Reversion Bot] Redis client already ready.');
}

const metaMap = await buildMetaMap(hyperliquid);

const CONFIG_BASE = path.resolve('./dist/config');
const reversionConfig = JSON.parse(fs.readFileSync(path.join(CONFIG_BASE, 'reversion-config.json'), 'utf-8'));

logInfo(`🚀 Starting Reversion Bot`);

await runReversionBot(hyperliquid, reversionConfig, metaMap);

scheduleHeartbeat(`Reversion Bot`, () => `Running`, 1);
