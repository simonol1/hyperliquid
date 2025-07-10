export const calculateEMA = (closes: any[], period: number) => {
  const k = 2 / (period + 1);
  return closes.reduce((ema, price, index) => (index === 0 ? price : (price - ema) * k + ema));
};
