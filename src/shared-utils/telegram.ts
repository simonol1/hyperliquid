import axios from 'axios';
import { logError, logDebug } from './logger.js';
import http from 'http';
import https from 'https';
import { TradeSignal } from './types.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';
export const monitorChatId = process.env.TELEGRAM_MONITOR_CHAT_ID;
export const summaryChatId = process.env.TELEGRAM_SUMMARY_CHAT_ID;
export const errorsChatId = process.env.TELEGRAM_ERROR_CHAT_ID;

/**
 * Escapes all characters required by Telegram MarkdownV2.
 * Full list: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export const escapeMarkdown = (text: string): string => {
    return text.replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1');
};

/**
 * Optional: Wrap content in Telegram code block (```...```) for raw formatting.
 */
const wrapCodeBlock = (text: string): string => {
    return ['```', text, '```'].join('\n');
};

export const sendTelegramMessage = async (
    text: string,
    chatId: string,
    escape: boolean = true
): Promise<void> => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        logError('❌ Telegram BOT_TOKEN is not set. Cannot send message.');
        return;
    }

    const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: escape ? escapeMarkdown(text) : text,
        parse_mode: 'MarkdownV2',
    };

    try {
        logDebug(`[Telegram] Attempting to send message to ${chatId}. Payload: ${JSON.stringify(payload)}`);
        await axios.post(url, payload, {
            timeout: 30000,
            httpAgent: new http.Agent({ family: 4 }),
            httpsAgent: new https.Agent({ family: 4 }),
        });
        logDebug(`[Telegram] Message sent successfully to ${chatId}`);
    } catch (err: any) {
        logError(`❌ Telegram send failed: ${err.message || JSON.stringify(err)}`);
        if (err.response) {
            logError(`[Telegram] Response Error Data: ${JSON.stringify(err.response.data)}`);
            logError(`[Telegram] Response Error Status: ${err.response.status}`);
            logError(`[Telegram] Response Error Headers: ${JSON.stringify(err.response.headers)}`);
        } else if (err.request) {
            logError(`[Telegram] No response received: Method ${err.config?.method}, URL: ${err.config?.url}`);
        }
        if (err.stack) {
            logError(`[Telegram] Error Stack: ${err.stack}`);
        }
    }
};


// --- Telegram Summary Formatter ---

export interface SignalSummary extends Pick<TradeSignal, 'coin' | 'side' | 'strength'> { }

export type SkippedReason = {
    coin: string;
    reason: string;
};

/**
 * Generates a clean, readable cycle summary message formatted for Telegram MarkdownV2.
 */
export const buildTelegramCycleSummary = (
    signals: SignalSummary[],
    skipped: SkippedReason[],
    active: number
): string => {
    const top = signals.sort((a, b) => b.strength - a.strength)[0];

    const isGolden = (strength: number) => strength >= 90;
    const star = (strength: number) => (isGolden(strength) ? '⭐️ ' : '');

    const topText = top
        ? `${star(top.strength)}${escapeMarkdown(top.coin)} ${escapeMarkdown(top.side)} *${escapeMarkdown(top.strength.toFixed(1))}*`
        : 'None';

    const skippedCoins = skipped.length
        ? skipped.map(s => escapeMarkdown(s.coin)).join(', ')
        : 'None';

    const summaryLines = [
        `*Cycle Summary*`,
        `Signals: *${escapeMarkdown(signals.length.toString())}*`,
        `Top: ${topText}`,
        `Skipped: *${escapeMarkdown(skipped.length.toString())}* — ${skippedCoins}`,
        `Active: *${escapeMarkdown(active.toString())}*`,
    ];

    return summaryLines.join('\n');
};
