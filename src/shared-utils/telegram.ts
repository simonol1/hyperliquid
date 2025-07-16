import axios from 'axios';
import { logError, logDebug } from './logger.js';
import http from 'http'; // Import Node.js 'http' module
import https from 'https'; // Import Node.js 'https' module

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

export const sendTelegramMessage = async (text: string, chatId: string): Promise<void> => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        logError('❌ Telegram BOT_TOKEN is not set. Cannot send message.');
        return;
    }

    const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;
    const payload = {
        chat_id: chatId,
        // The 'text' argument is expected to already be correctly MarkdownV2 formatted.
        // The responsibility of escaping dynamic content (like coin names)
        // now lies with the function that builds the 'text' (e.g., buildTelegramCycleSummary).
        text: text,
        parse_mode: 'MarkdownV2',
    };

    try {
        logDebug(`[Telegram] Attempting to send message to ${chatId}. URL: ${url}. Payload: ${JSON.stringify(payload)}`);

        await axios.post(url, payload, {
            timeout: 30000, // Keep 30-second timeout
            httpAgent: new http.Agent({ family: 4 }), // Force IPv4 for HTTP requests using imported 'http'
            httpsAgent: new https.Agent({ family: 4 }), // Force IPv4 for HTTPS requests using imported 'https'
        });

        logDebug(`[Telegram] Message sent successfully to ${chatId}`);
    } catch (err: any) {
        logError(`❌ Telegram send failed: ${err.message || JSON.stringify(err)}`);

        if (err.response) {
            logError(`[Telegram] Response Error Data: ${JSON.stringify(err.response.data)}`);
            logError(`[Telegram] Response Error Status: ${err.response.status}`);
            logError(`[Telegram] Response Error Headers: ${JSON.stringify(err.response.headers)}`);
        } else if (err.request) {
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
