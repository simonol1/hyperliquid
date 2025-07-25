import axios from 'axios';
import { logError, logDebug, logWarn } from './logger.js';
import http from 'http';
import https from 'https';

export const errorsChatId = process.env.TELEGRAM_ERROR_CHAT_ID
export const summaryChatId = process.env.TELEGRAM_SUMMARY_CHAT_ID
export const monitorChatId = process.env.TELEGRAM_MONITOR_CHAT_ID

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';
const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
    throw new Error('❌ TELEGRAM_BOT_TOKEN is missing');
}

export type SkippedReason = {
    coin: string;
    reason: string;
};

type PendingMessage = {
    text: string;
    escape: boolean;
    resolve: () => void;
    reject: (err: any) => void;
};

// Per-chat queues
const chatQueues: Record<string, PendingMessage[]> = {};
const isSending: Record<string, boolean> = {};

/**
 * Escapes all characters required by Telegram MarkdownV2.
 */
export const escapeMarkdown = (text: string): string =>
    text.replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1');

const sendNow = async (chatId: string, text: string, escape: boolean = true): Promise<void> => {
    const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: escape ? escapeMarkdown(text) : text,
        parse_mode: 'MarkdownV2',
    };

    try {
        await axios.post(url, payload, {
            timeout: 30000,
            httpAgent: new http.Agent({ family: 4 }),
            httpsAgent: new https.Agent({ family: 4 }),
        });
        logDebug(`[Telegram] ✅ Message sent to ${chatId}`);
    } catch (err: any) {
        if (err.response?.status === 429) {
            const retryAfter = err.response.data?.parameters?.retry_after || 5;
            logWarn(`[Telegram] ⏳ Rate limited for ${retryAfter}s. Waiting...`);
            await new Promise((r) => setTimeout(r, retryAfter * 1000));
            return sendNow(chatId, text, escape); // Retry once
        } else {
            logError(`[Telegram] ❌ Failed to send message: ${err.message}`);
            if (err.response) {
                logError(`[Telegram] ❌ Response Data: ${JSON.stringify(err.response.data)}`);
            }
            throw err;
        }
    }
};

const processQueue = async (chatId: string) => {
    if (isSending[chatId]) return;
    isSending[chatId] = true;

    while (chatQueues[chatId]?.length > 0) {
        const msg = chatQueues[chatId].shift();
        if (!msg) continue;

        try {
            await sendNow(chatId, msg.text, msg.escape);
            await new Promise((r) => setTimeout(r, 1000)); // 1s delay between sends
            msg.resolve();
        } catch (err) {
            msg.reject(err);
        }
    }

    isSending[chatId] = false;
};

/**
 * Queued + rate-limited Telegram message sender.
 */
export const sendTelegramMessage = (text: string, chatId: string, escape: boolean = true): Promise<void> => {
    if (!chatId) {
        logError('❌ Telegram chatId missing');
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        if (!chatQueues[chatId]) chatQueues[chatId] = [];
        chatQueues[chatId].push({ text, escape, resolve, reject });
        processQueue(chatId);
    });
};
