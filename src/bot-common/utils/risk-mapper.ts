export interface RiskMapping {
    minScore: number;         // e.g. 60
    goldenScore: number;      // e.g. 95
    minCapitalRiskPct: number; // e.g. 0.02 (2%)
    maxCapitalRiskPct: number; // e.g. 0.1 (10%)
    minLeverage: number;      // e.g. 3
    maxLeverage: number;      // e.g. 10
}

export interface PositionSizingResult {
    capitalRiskUsd: number;
    leverage: number;
    capitalRiskPct: number;
}

export const calculatePositionSize = (
    signalStrength: number, // 0-100
    maxCapitalRiskUsd: number,
    risk: RiskMapping
): PositionSizingResult => {
    // Clamp the score to [0, 100]
    const score = Math.max(0, Math.min(100, signalStrength));

    // Map strength to % risk: linearly scaled between minScore → goldenScore
    const scoreRange = Math.max(1, risk.goldenScore - risk.minScore);
    const effectiveScore = Math.max(0, score - risk.minScore);

    const riskPct = risk.minCapitalRiskPct +
        (effectiveScore / scoreRange) * (risk.maxCapitalRiskPct - risk.minCapitalRiskPct);

    const capitalRiskPct = Math.min(risk.maxCapitalRiskPct, Math.max(risk.minCapitalRiskPct, riskPct));

    const capitalRiskUsd = capitalRiskPct * maxCapitalRiskUsd;

    const leverage = Math.min(
        risk.maxLeverage,
        Math.max(
            risk.minLeverage,
            (score / risk.goldenScore) * risk.maxLeverage
        )
    );

    return {
        capitalRiskUsd: 10, // For testing, replace with actual calculation
        leverage,
        capitalRiskPct
    };
}

