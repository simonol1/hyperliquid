import { Hyperliquid } from "../../sdk";

export interface CoinMeta {
    coin: string;
    szDecimals: number;
    pxDecimals: number;
    minVlmUsd: number;
    maxLeverage: number;
    dayNtlVlm: number;
    openInterest: number;
    onlyIsolated?: boolean;
}

export const buildMetaMap = async (
    hyperliquid: Hyperliquid
): Promise<Map<string, CoinMeta>> => {
    const [meta, assetCtxs] = await hyperliquid.info.perpetuals.getMetaAndAssetCtxs();
    const metaMap = new Map<string, CoinMeta>();

    for (let i = 0; i < meta.universe.length; i++) {
        const coin = meta.universe[i];
        const ctx = assetCtxs[i];
        const staticMeta = COIN_META[coin.name] ?? { pxDecimals: 2, minVlmUsd: 100_000 };

        metaMap.set(coin.name, {
            coin: coin.name,
            szDecimals: coin.szDecimals,
            pxDecimals: staticMeta.pxDecimals,
            maxLeverage: coin.maxLeverage,
            onlyIsolated: coin.onlyIsolated,
            dayNtlVlm: Number(ctx.dayNtlVlm) || 0,
            openInterest: Number(ctx.openInterest) || 0,
            minVlmUsd: staticMeta.minVlmUsd,
        });
    }

    return metaMap;
};

export const COIN_META: Record<string, { pxDecimals: number; minVlmUsd: number }> = {
    // Majors
    "BTC-PERP": { pxDecimals: 2, minVlmUsd: 10_000_000 },
    "ETH-PERP": { pxDecimals: 2, minVlmUsd: 5_000_000 },
    "SOL-PERP": { pxDecimals: 2, minVlmUsd: 2_000_000 },
    "LINK-PERP": { pxDecimals: 3, minVlmUsd: 1_000_000 },

    // Mid-caps
    "ARB-PERP": { pxDecimals: 4, minVlmUsd: 1_000_000 },
    "SUI-PERP": { pxDecimals: 4, minVlmUsd: 1_000_000 },
    "SEI-PERP": { pxDecimals: 4, minVlmUsd: 500_000 },
    "WLD-PERP": { pxDecimals: 4, minVlmUsd: 500_000 },

    // Meme coins
    "DOGE-PERP": { pxDecimals: 5, minVlmUsd: 1_000_000 },
    "SHIB-PERP": { pxDecimals: 8, minVlmUsd: 500_000 },
    "PEPE-PERP": { pxDecimals: 8, minVlmUsd: 500_000 },
    "FLOKI-PERP": { pxDecimals: 8, minVlmUsd: 500_000 },
    "BONK-PERP": { pxDecimals: 8, minVlmUsd: 500_000 },
    "WIF-PERP": { pxDecimals: 5, minVlmUsd: 500_000 },
    "HYPE-PERP": { pxDecimals: 3, minVlmUsd: 500_000 },
};
