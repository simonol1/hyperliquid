// src/utils/scheduler.ts
import { sendTelegramMessage } from './telegram.js';
import { logInfo } from './logger.js';
import cron from 'node-cron';

/**
 * Daily summary
 */
export const scheduleDailyReport = (
    botName: string,
    getSummary: () => string | Promise<string>
) => {
    cron.schedule('0 21 * * *', async () => {
        const summary = await getSummary();
        await sendTelegramMessage(`*${botName} Daily Report*\n\n${summary}`);
    });

    logInfo('Daily report scheduled: 21:00 server time');
}

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
}
