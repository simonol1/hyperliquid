export interface RiskMapping {
  minScore: number;             // minimum signal score to consider
  goldenScore: number;          // score for max risk / max leverage
  minCapitalRiskPct: number;    // min % of portfolio to risk per trade
  maxCapitalRiskPct: number;    // max % of portfolio to risk per trade
  minLeverage: number;          // min leverage to apply
  maxLeverage: number;          // max leverage to apply
}

export interface BotConfig {
  strategy: string;             // e.g. "trend", "breakout", "reversion"
  coins: string[];
  loopIntervalMs: number;       // main loop interval
  timeframe: string;            // e.g. "1h"

  emaFastPeriod: number;        // fast EMA, e.g. 10, 20
  emaMediumPeriod: number;      // medium EMA, e.g. 50
  emaSlowPeriod: number;        // slow EMA, e.g. 200

  rsiPeriod: number;
  macdFastPeriod: number;
  macdSlowPeriod: number;
  macdSignalPeriod: number;
  bollingerPeriod?: number;     // optional override for BB

  rsiOverboughtThreshold: number;
  rsiOversoldThreshold: number;

  trailingStopPct: number;      // trailing stop % drop
  initialTakeProfitPct: number; // TP % gain

  maxConcurrentTrades: number
  maxCapitalRiskUsd: number;    // hard USD max per trade
  leverage: number;             // default desired leverage
  walletAddress: string;        // sub-account wallet for this bot

  riskMapping: RiskMapping;     // dynamic risk map
}
