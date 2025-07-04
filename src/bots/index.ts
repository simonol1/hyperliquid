import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

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

dotenv.config();

const configPath =
  process.env.BOT_CONFIG || path.resolve('src/bots/config/trend-config.json');

if (!fs.existsSync(configPath)) {
  console.error(`❌ Config file not found: ${configPath}`);
  process.exit(1);
}

const strategyConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Attach a global unhandled error logger
process.on('uncaughtException', (err) => {
  logError(`❌ Uncaught Exception: ${err}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logError(`❌ Unhandled Rejection: ${reason}`);
  process.exit(1);
});

const shutdown = () => {
  logInfo('🔌 Received shutdown signal. Exiting...');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const run = async () => {
  logInfo(`🔑 Strategy config: ${JSON.stringify(strategyConfig, null, 2)}`);

  const hyperliquid = new Hyperliquid({
    privateKey: process.env.HYPERLIQUID_AGENT_PRIVATE_KEY,
    walletAddress: strategyConfig.walletAddress,
    testnet: process.env.HYPERLIQUID_TESTNET === 'true',
  });

  await hyperliquid.connect();
  logInfo(`✅ Connected. Running "${strategyConfig.strategy}" bot for ${strategyConfig.walletAddress}`);

  const maxLeverageMap = await getMaxLeverageMap(hyperliquid);
  logInfo(`✅ Loaded max leverage per pair → ${Object.keys(maxLeverageMap).length} pairs.`);

  switch (strategyConfig.strategy) {
    case 'trend':
      scheduleDailyReport('Trend Bot', getTrendSummary);
      scheduleHeartbeat('Trend Bot', getTrendStatus, 2);
      await runTrendBot(hyperliquid, strategyConfig, maxLeverageMap);
      break;

    // case 'breakout':
    //   scheduleDailyReport('Breakout Bot', getBreakoutSummary);
    //   scheduleHeartbeat('Breakout Bot', getBreakoutStatus, 2);
    //   await runBreakoutBot(hyperliquid, strategyConfig, maxLeverageMap);
    //   break;

    // case 'reversion':
    //   scheduleDailyReport('Reversion Bot', getReversionSummary);
    //   scheduleHeartbeat('Reversion Bot', getReversionStatus, 2);
    //   await runReversionBot(hyperliquid, strategyConfig, maxLeverageMap);
    //   break;

    default:
      throw new Error(`❌ Unknown strategy: ${strategyConfig.strategy}`);
  }
};

run().catch((err) => {
  logError(`❌ Fatal bot error: ${err}`);
  process.exit(1);
});
