import axios from 'axios';
import { logError, logDebug } from './logger.js'; // Ensure logDebug is imported

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

export const sendTelegramMessage = async (text: string, chatId: string): Promise<void> => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN; // Assuming this environment variable exists
    if (!botToken) {
        logError('❌ Telegram BOT_TOKEN is not set. Cannot send message.');
        return;
    }

    const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'MarkdownV2',
    };

    try {
        logDebug(`[Telegram] Attempting to send message to ${chatId}. URL: ${url}. Payload: ${JSON.stringify(payload)}`);

        await axios.post(url, payload, {
            timeout: 30000, // Increased timeout to 30 seconds (30000ms)
            // You can adjust this timeout based on your network conditions and Telegram API responsiveness.
            // If you still see timeouts, try increasing this value.
        });

        logDebug(`[Telegram] Message sent successfully to ${chatId}`);
    } catch (err: any) {
        // Log the full error object to get more context
        logError(`❌ Telegram send failed: ${err.message || JSON.stringify(err)}`);

        if (err.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            logError(`[Telegram] Response Error Data: ${JSON.stringify(err.response.data)}`);
            logError(`[Telegram] Response Error Status: ${err.response.status}`);
            logError(`[Telegram] Response Error Headers: ${JSON.stringify(err.response.headers)}`);
        } else if (err.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an http.ClientRequest in node.js
            // Safely log relevant properties of err.request to avoid circular JSON error
            logError(`[Telegram] No response received. Request details: ` +
                `Method: ${err.config?.method}, URL: ${err.config?.url}, ` +
                `Headers: ${JSON.stringify(err.config?.headers)}, ` +
                `Timeout: ${err.config?.timeout}, Code: ${err.code}`);
        }
        if (err.stack) {
            logError(`[Telegram] Error Stack: ${err.stack}`);
        }
    }
};
