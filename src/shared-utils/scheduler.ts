// ✅ File: reporter/scheduler.ts
import { sendTelegramMessage, monitorChatId } from '../shared-utils/telegram.js';
import { logError, logInfo, logWarn } from '../shared-utils/logger.js';
import cron from 'node-cron';
import { stateManager } from '../shared-utils/state-manager.js';
import { redis } from './redis-client.js';

// Daily Loss Reset (Local Only)
export const scheduleDailyReset = () => {
    cron.schedule('0 17 * * *', () => {
        stateManager.resetDailyLoss();
        logWarn('[RiskManager] ✅ Daily loss reset at 5pm.');
    });
    logWarn('Daily loss reset scheduled at 17:00 server time.');
};

// Global hourly heartbeat
export const scheduleGlobalHeartbeat = () => {
    cron.schedule('0 * * * *', async () => {
        if (!monitorChatId) {
            logError(`[Heartbeat] ❌ Missing TELEGRAM_MONITOR_CHAT_ID. Cannot send global heartbeat`);
            return;
        }

        const botStatus = await Promise.all(
            ['trend', 'breakout', 'reversion'].map(bot => redis.get(`status:${bot}`))
        );

        const message = [
            `✅ *Global Health Check*`,
            ...['trend', 'breakout', 'reversion'].map((bot, i) => `${bot}: ${botStatus[i] || '❓ No data'}`),
            `🕐 Time: ${new Date().toLocaleString()}`
        ].join('\n');

        await sendTelegramMessage(message, monitorChatId);
        logInfo(`[Heartbeat] ✅ Sent global heartbeat`);
    });

    logInfo(`[Heartbeat] ⏰ Global heartbeat scheduled hourly`);
};
