export interface RiskMapping {
  minScore: number;             // minimum signal score to consider
  goldenScore: number;          // score for max risk / max leverage
  minCapitalRiskPct: number;    // min % of portfolio to risk per trade
  maxCapitalRiskPct: number;    // max % of portfolio to risk per trade
  minLeverage: number;          // min leverage to apply
  maxLeverage: number;          // max leverage to apply
}

export type StrategyType = 'trend' | 'breakout' | 'reversion';

export interface CoinConfigOverrides {
  timeframe?: string;
  minVolumeUsd?: number;
  lookback?: number;
  reversionDistanceThreshold?: number;
  reversionMaxDistance?: number;
  // Add others as needed later (e.g., emaSlowPeriod, thresholds)
}

export interface BotConfig {
  strategy: StrategyType;
  coins: string[];
  loopIntervalMs: number;
  timeframe: string;

  emaFastPeriod?: number;
  emaMediumPeriod?: number;
  emaSlowPeriod: number;

  rsiPeriod: number;
  macdFastPeriod: number;
  macdSlowPeriod: number;
  macdSignalPeriod: number;
  bollingerPeriod?: number;

  rsiOverboughtThreshold: number;
  rsiOversoldThreshold: number;

  trailingStopPct: number;
  stopLossPct: number;

  subaccountAddress: string;

  riskMapping: RiskMapping;
  minVolumeUsd: number;
  coinConfig?: {
    [coin: string]: CoinConfigOverrides
  };
}
