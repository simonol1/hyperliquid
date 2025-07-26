import fs from 'fs';
import path from 'path';
import pino from 'pino';
import type { Analysis } from './analyse-asset';
import { errorsChatId, sendTelegramMessage } from './telegram';

// === File setup ===
const today = new Date().toISOString().split('T')[0];
const logsDir = path.resolve('logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFilePath = path.join(logsDir, `trades_${today}.log`);

// FIX: Read LOG_LEVEL from environment variable, default to 'info' if not set
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const logger = pino(
  {
    level: LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: fs.createWriteStream(logFilePath, { flags: 'a' }) },
  ])
);

export const logInfo = (msg: string) => logger.info(`${msg}`);
export const logDebug = (msg: string) => logger.debug(`${msg}`);
export const logWarn = (msg: string | unknown) => logger.warn(` ⚠️ ${msg}`);

export const logError = (msg: string | Error) => {
  const timestamp = new Date().toISOString();
  const isError = msg instanceof Error;
  const message = isError ? msg.message : msg;
  const stack = isError && msg.stack ? `\n\n*Stack Trace:*\n\`\`\`\n${msg.stack}\n\`\`\`` : '';

  const telegramMessage = [
    `❌ *Error Logged*`,
    `🕒 ${timestamp}`,
    `*Message:* ${message}`,
    stack
  ].join('\n');

  console.error(`[ERROR] ${message}`);

  if (errorsChatId) {
    sendTelegramMessage(telegramMessage, errorsChatId).catch(() => { });
  }
};


export const logTrade = ({
  asset,
  side,
  qty,
  price,
  leverage,
  strength,
}: {
  asset: string;
  side: string;
  qty: number;
  price: number;
  leverage: number;
  strength: number;
}) => {
  const line = `[TRADE] ${asset} ${qty.toFixed(4)} ${side} @ $${price.toFixed(
    2
  )} | L:${leverage}x | Strength: ${strength}`;
  logger.info(line);
};

export const logExit = ({
  asset,
  price,
  reason,
}: {
  asset: string;
  price: number;
  reason: string;
}) => {
  const line = `[EXIT] ${asset} at $${price.toFixed(2)} | Reason: ${reason}`;
  logger.info(line);
};

export const logAnalysis = (asset: string, a: Analysis) => {
  const emaParts = [];
  if (a.fastEma) emaParts.push(`Fast(${a.fastEma.toFixed(2)})`);
  if (a.mediumEma) emaParts.push(`Medium(${a.mediumEma.toFixed(2)})`);
  if (a.slowEma) emaParts.push(`Slow(${a.slowEma.toFixed(2)})`);
  const emaOutput = emaParts.length ? ` | EMAs: ${emaParts.join(', ')}` : '';

  logger.debug(
    `[AnalyseData] ${asset} | Price: ${a.currentPrice.toFixed(
      2
    )}${emaOutput} | RSI: ${a.rsi.toFixed(1)} | MACD: ${a.macd.toFixed(
      2
    )} | BB: [${a.bollingerBands.lower.toFixed(2)} - ${a.bollingerBands.upper.toFixed(2)}]`
  );
};
