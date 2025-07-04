import { Hyperliquid } from "../../sdk";

export const getMaxLeverageMap = async (hyperliquid: Hyperliquid): Promise<Record<string, number>> => {
    const meta = await hyperliquid.info.perpetuals.getMeta();
    const maxLeverageMap: Record<string, number> = {};

    for (const coin of meta.universe) {
        maxLeverageMap[coin.name] = coin.maxLeverage;
    }

    return maxLeverageMap;
};
