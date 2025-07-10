/**
 * Get interval in ms for a timeframe like "1h" or "5m".
 */
export const getIntervalMs = (timeframe: string) => {
  if (timeframe.endsWith('h')) return parseInt(timeframe) * 60 * 60 * 1000;
  if (timeframe.endsWith('m')) return parseInt(timeframe) * 60 * 1000;
  throw new Error(`Unsupported timeframe: ${timeframe}`);
};

/**
 * Safe JSON.parse wrapper.
 * Returns `null` if parsing fails.
 */
export const safeParse = <T>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};
