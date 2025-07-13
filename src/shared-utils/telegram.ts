import axios from 'axios';
import { logInfo, logWarn, logError } from './logger.js';

const escapeMarkdown = (text: string) =>
    text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');

export const sendTelegramMessage = async (text: string) => {
    let botToken = process.env.TELEGRAM_BOT_TOKEN;
    let chatId = process.env.TELEGRAM_CHAT_ID;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
        const res = await axios.post(url, {
            chat_id: chatId,
            text: escapeMarkdown(text),
            parse_mode: 'MarkdownV2',
        });
        logInfo(`✅ Telegram message sent: ${res.data.ok}`);
    } catch (err: any) {
        logError(`Telegram send failed: ${err.response?.status} — ${JSON.stringify(err)}`);
        logError(`DEBUG send failed: ${err.response?.status} — ${JSON.stringify(err)}`);

    }
}
