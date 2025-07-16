// === Polyfill WS ===
import ws from 'ws';
globalThis.WebSocket = ws as any;

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { Hyperliquid } from '../sdk/index'
import { logInfo, logWarn, logError } from '../shared-utils/logger.js';
import { buildMetaMap } from '../shared-utils/coin-meta.js';
import { runTrendBot } from './strategies/trend.js';
import { scheduleHeartbeat } from '../shared-utils/scheduler.js';
// Import the Redis client
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

// Initialize Hyperliquid client
const hyperliquid = new Hyperliquid({
    enableWs: true,
    privateKey: process.env.HYPERLIQUID_AGENT_PRIVATE_KEY,
    walletAddress: process.env.HYPERLIQUID_AGENT_WALLET,
    vaultAddress: subaccountAddress,
});

// Connect to Hyperliquid
await hyperliquid.connect();
logInfo(`✅ [Trend Bot] Connected to Hyperliquid`);

// NEW: Explicitly wait for Redis client to be truly open and ready
// This is crucial to ensure Redis operations don't fail due to a closed client.
// We wait for 'ready' AND ensure it's 'isOpen'.
if (!redis.isOpen) { // Check if it's not already open
    logInfo('[Trend Bot] Waiting for Redis client to be open and ready...');
    await new Promise<void>((resolve, reject) => {
        const onReady = () => {
            if (redis.isOpen) { // Confirm it's actually open when ready
                redis.off('ready', onReady);
                redis.off('error', onError); // Remove error listener if successful
                resolve();
            } else {
                // This case should ideally not happen if 'ready' implies 'isOpen',
                // but adding a small delay or more robust check might be needed if it does.
                logWarn('[Trend Bot] Redis client reported ready but not open. Waiting for reconnect...');
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
    logInfo('[Trend Bot] Redis client is open and ready.');
} else {
    logInfo('[Trend Bot] Redis client already open and ready.');
}

const metaMap = await buildMetaMap(hyperliquid);

const CONFIG_BASE = path.resolve('./dist/config');
const trendConfig = JSON.parse(fs.readFileSync(path.join(CONFIG_BASE, 'trend-config.json'), 'utf-8'));

logInfo(`🚀 Starting Trend Bot`);

// Run the main bot logic
await runTrendBot(hyperliquid, trendConfig, metaMap);

scheduleHeartbeat(`Trend Bot`, () => `Running`, 1);
