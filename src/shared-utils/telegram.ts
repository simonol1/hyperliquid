import axios from 'axios';
import { logInfo, logWarn, logError } from './logger.js';

export const sendTelegramMessage = async (text: string) => {
    let botToken = process.env.TELEGRAM_BOT_TOKEN;
    let chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken) {
        logError('Missing TELEGRAM_BOT_TOKEN');
        return;
    }

    if (!chatId) {
        logWarn('TELEGRAM_CHAT_ID not set — trying to auto-fetch...');
        const fetched = await getChatIdFromUpdates(botToken);
        if (!fetched) {
            logError(
                'Could not get chat_id. Send your bot a message first and try again.'
            );
            return;
        }
        chatId = fetched;
        logInfo(`Auto-fetched TELEGRAM_CHAT_ID: ${chatId}`);
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
        const res = await axios.post(url, {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
        });
        logInfo(`✅ Telegram message sent: ${res.data.ok}`);
    } catch (err: any) {
        logError(`Telegram send failed: ${err.response?.data || err}`);
    }
}

async function getChatIdFromUpdates(botToken: string): Promise<string | null> {
    const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
    try {
        const res = await axios.get(url);
        const updates = res.data.result;
        if (updates && updates.length > 0) {
            const chatId = updates[updates.length - 1].message.chat.id;
            return `${chatId}`;
        } else {
            logWarn('No chat_id found — have you sent your bot a message?');
            return null;
        }
    } catch (err: any) {
        logError(`getUpdates failed: ${err.response?.data || err}`);
        return null;
    }
}
