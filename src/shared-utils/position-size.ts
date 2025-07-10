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
    maxCapitalRiskUsd: number,
    risk: RiskMapping
): PositionSizingResult => {
    const score = Math.max(0, Math.min(100, signalStrength));
    const scoreRange = Math.max(1, risk.goldenScore - risk.minScore);
    const effectiveScore = Math.max(0, score - risk.minScore);

    const riskPct =
        risk.minCapitalRiskPct +
        (effectiveScore / scoreRange) * (risk.maxCapitalRiskPct - risk.minCapitalRiskPct);

    const capitalRiskPct = Math.min(risk.maxCapitalRiskPct, Math.max(risk.minCapitalRiskPct, riskPct));
    const capitalRiskUsd = capitalRiskPct * maxCapitalRiskUsd;

    const leverage = Math.min(
        risk.maxLeverage,
        Math.max(risk.minLeverage, (score / risk.goldenScore) * risk.maxLeverage)
    );

    return {
        capitalRiskUsd,
        leverage,
        capitalRiskPct,
    };
};
