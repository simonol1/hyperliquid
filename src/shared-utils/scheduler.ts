import { sendTelegramMessage } from './telegram.js';
import { logInfo } from './logger.js';
import cron from 'node-cron';
import { stateManager } from './state-manager.js';

/**
 * Heartbeat every N hours
 */
export const scheduleHeartbeat = (
    botName: string,
    getStatus: () => string | Promise<string>,
    intervalHours: number = 2
) => {
    const cronExpression = `0 */${intervalHours} * * *`; // on the hour every N hours
    cron.schedule(cronExpression, async () => {
        const status = await getStatus();
        await sendTelegramMessage(`✅ *${botName} heartbeat*\n${status}`);
    });

    logInfo(`Heartbeat scheduled: every ${intervalHours} hour(s)`);
};

/**
 * 🕛 Daily loss reset at 5pm
 */
export const scheduleDailyReset = () => {
    cron.schedule('0 17 * * *', () => {
        stateManager.resetDailyLoss();
        logInfo('[RiskManager] ✅ Daily loss reset at 5pm.');
    });

    logInfo('Daily loss reset schedule set: 5pm server time');
};
