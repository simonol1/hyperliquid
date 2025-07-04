export function mapRisk(
    signalScore: number,
    minScore: number,
    goldenScore: number,
    minCapitalRiskPct: number,
    maxCapitalRiskPct: number,
    minLeverage: number,
    maxLeverage: number
) {
    if (signalScore >= goldenScore) {
        return { positionPct: maxCapitalRiskPct, leverage: maxLeverage };
    }
    const ratio = (signalScore - minScore) / (100 - minScore);
    const positionPct = minCapitalRiskPct + ratio * (maxCapitalRiskPct - minCapitalRiskPct);
    const leverage = minLeverage + ratio * (maxLeverage - minLeverage);
    return { positionPct, leverage };
}
