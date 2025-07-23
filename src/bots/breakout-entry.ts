// === Polyfill WS ===
import ws from 'ws';
globalThis.WebSocket = ws as any;

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { Hyperliquid } from '../sdk/index.js';
import { logInfo, logError, logWarn } from '../shared-utils/logger.js';
import { buildMetaMap } from '../shared-utils/coin-meta.js';
import { runBreakoutBot } from './strategies/breakout.js';
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
logInfo(`✅ [Breakout Bot] Connected to Hyperliquid`);

// NEW: Explicitly wait for Redis client to be truly open and ready
// This is crucial to ensure Redis operations don't fail due to a closed client.
// We wait for 'ready' AND ensure it's 'isOpen'.
if (!redis.isOpen) { // Check if it's not already open
    logInfo('[Breakout Bot] Waiting for Redis client to be open and ready...');
    await new Promise<void>((resolve, reject) => {
        const onReady = () => {
            if (redis.isOpen) { // Confirm it's actually open when ready
                redis.off('ready', onReady);
                redis.off('error', onError); // Remove error listener if successful
                resolve();
            } else {
                // This case should ideally not happen if 'ready' implies 'isOpen',
                // but adding a small delay or more robust check might be needed if it does.
                logWarn('[Breakout Bot] Redis client reported ready but not open. Waiting for reconnect...');
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
    logInfo('[Breakout Bot] Redis client is open and ready.');
} else {
    logInfo('[Breakout Bot] Redis client already open and ready.');
}

const metaMap = await buildMetaMap(hyperliquid);

const CONFIG_BASE = path.resolve('./dist/config');
const breakoutConfig = JSON.parse(fs.readFileSync(path.join(CONFIG_BASE, 'breakout-config.json'), 'utf-8'));

logInfo(`🚀 Starting Breakout Bot`);

await runBreakoutBot(hyperliquid, breakoutConfig, metaMap);
