// ✅ File: reporter/scheduler.ts
import { sendTelegramMessage } from '../shared-utils/telegram.js';
import { logInfo, logWarn } from '../shared-utils/logger.js';
import cron from 'node-cron';
import { stateManager } from '../shared-utils/state-manager.js';

// Heartbeat to Monitoring Channel
export const scheduleHeartbeat = (
    botName: string,
    getStatus: () => string | Promise<string>,
    intervalHours: number = 2
) => {
    cron.schedule(`0 */${intervalHours} * * *`, async () => {
        const status = await getStatus();
        const chatId = process.env.TELEGRAM_MONITOR_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
        if (!chatId) throw new Error("Missing Telegram Chat ID");

        await sendTelegramMessage(`✅ *${botName} heartbeat*\n${status}`, chatId);

        logWarn(`[Heartbeat] Sent for ${botName}`);
    });
    logWarn(`Heartbeat scheduled every ${intervalHours} hour(s)`);
};

// Daily Loss Reset (Local Only)
export const scheduleDailyReset = () => {
    cron.schedule('0 17 * * *', () => {
        stateManager.resetDailyLoss();
        logWarn('[RiskManager] ✅ Daily loss reset at 5pm.');
    });
    logWarn('Daily loss reset scheduled at 17:00 server time.');
};
