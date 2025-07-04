export const calculateBollingerBands = (closes: any, period = 20, multiplier = 2) => {
  const slice = closes.slice(-period);
  const mean = slice.reduce((a: any, b: any) => a + b, 0) / period;
  const variance =
    slice.reduce((sum: number, p: number) => sum + Math.pow(p - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: mean + multiplier * stdDev,
    lower: mean - multiplier * stdDev,
  };
};
