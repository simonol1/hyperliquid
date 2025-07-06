import fs from 'fs';
import path from 'path';
import type { Analysis } from '../analyse-asset';

// Optional: could use dayjs for fancy timestamps
const now = () => new Date().toISOString();

const LOG_PREFIX = '[BOT]';

export const logInfo = (msg: string) =>
  console.log(`${LOG_PREFIX} [INFO] [${now()}] ${msg}`);

export const logWarn = (msg: string | unknown) =>
  console.warn(`${LOG_PREFIX} [WARN] [${now()}] ⚠️  ${msg}`);

export const logError = (msg: string | unknown) =>
  console.error(`${LOG_PREFIX} [ERROR] [${now()}] ❌ ${msg}`);

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
  const line = `[TRADE] [${now()}] ${asset} ${side} ${qty.toFixed(
    4
  )} @ $${price.toFixed(2)} | L:${leverage}x | Strength: ${strength}`;
  console.log(line);
  appendLogFile(line);
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
  const line = `[EXIT] [${now()}] ${asset} at $${price.toFixed(
    2
  )} | Reason: ${reason}`;
  console.log(line);
  appendLogFile(line);
};

// Rotating log path: logs/trades_YYYY-MM-DD.log
const logFilePath = path.resolve(
  'logs',
  `trades_${new Date().toISOString().split('T')[0]}.log`
);

export const appendLogFile = (msg: string) => {
  try {
    fs.appendFileSync(logFilePath, msg + '\n', { encoding: 'utf8' });
  } catch (err) {
    console.error(`${LOG_PREFIX} [ERROR] [${now()}] ❌ Failed to append log file`, err);
  }
};

/**
 * Cleanly log an Analysis snapshot.
 * Includes EMAs only if they are valid.
 */
export const logAnalysis = (asset: string, a: Analysis) => {
  const emaParts = [];
  if (a.fastEma) emaParts.push(`Fast(${a.fastEma.toFixed(2)})`);
  if (a.mediumEma) emaParts.push(`Medium(${a.mediumEma.toFixed(2)})`);
  if (a.slowEma) emaParts.push(`Slow(${a.slowEma.toFixed(2)})`);
  const emaOutput = emaParts.length ? ` | EMAs: ${emaParts.join(', ')}` : '';

  logInfo(
    `[AnalyseData] ${asset} | Price: ${a.currentPrice.toFixed(2)}${emaOutput} | RSI: ${a.rsi.toFixed(
      1
    )} | MACD: ${a.macd.toFixed(2)} | BB: [${a.bollingerBands.lower.toFixed(2)} - ${a.bollingerBands.upper.toFixed(2)}]`
  );
};
