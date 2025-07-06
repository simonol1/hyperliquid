export const getIntervalMs = (timeframe: string) => {
  if (timeframe.endsWith('h')) return parseInt(timeframe) * 60 * 60 * 1000;
  if (timeframe.endsWith('m')) return parseInt(timeframe) * 60 * 1000;
  throw new Error('Unsupported timeframe');
};