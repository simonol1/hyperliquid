export interface RiskMapping {
    minScore: number;
    goldenScore: number;
    minCapitalRiskPct: number;
    maxCapitalRiskPct: number;
    minLeverage: number;
    maxLeverage: number;
}

export interface PositionSizingResult {
    capitalRiskUsd: number;
    leverage: number;
    capitalRiskPct: number;
}

export const calculatePositionSize = (
    signalStrength: number,
    walletBalance: number,
    risk: RiskMapping
): PositionSizingResult => {

    const score = Math.min(100, Math.max(0, signalStrength));
    const scoreRange = Math.max(1, risk.goldenScore - risk.minScore);
    const effectiveScore = Math.max(0, score - risk.minScore);

    const capitalRiskPct = risk.minCapitalRiskPct +
        (effectiveScore / scoreRange) * (risk.maxCapitalRiskPct - risk.minCapitalRiskPct);

    const capitalRiskUsd = capitalRiskPct * walletBalance;

    const leverage = Math.round(
        Math.max(
            risk.minLeverage,
            Math.min(risk.maxLeverage, (score / risk.goldenScore) * risk.maxLeverage)
        )
    );

    return {
        capitalRiskUsd,
        leverage,
        capitalRiskPct,
    };
};

