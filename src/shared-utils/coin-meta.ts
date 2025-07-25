import { Hyperliquid } from "../sdk/index";

export interface CoinMeta {
    coin: string;
    szDecimals: number;
    pxDecimals: number;
    minVlmUsd: number;
    maxLeverage: number;
    dayNtlVlm: number;
    openInterest: number;
    onlyIsolated?: boolean;
    minSize: number; // ADDED: minSize to CoinMeta interface
}

export const buildMetaMap = async (
    hyperliquid: Hyperliquid
): Promise<Map<string, CoinMeta>> => {
    const [meta, assetCtxs] = await hyperliquid.info.perpetuals.getMetaAndAssetCtxs();
    const metaMap = new Map<string, CoinMeta>();

    for (let i = 0; i < meta.universe.length; i++) {
        const coin = meta.universe[i];
        const ctx = assetCtxs[i];
        // Ensure staticMeta also includes minSize. Default to 0 if not explicitly set.
        const staticMeta = COIN_META[coin.name] ?? { pxDecimals: 2, minVlmUsd: 100_000, minSize: 0 };

        metaMap.set(coin.name, {
            coin: coin.name,
            szDecimals: coin.szDecimals,
            pxDecimals: staticMeta.pxDecimals,
            maxLeverage: coin.maxLeverage,
            onlyIsolated: coin.onlyIsolated,
            dayNtlVlm: Number(ctx.dayNtlVlm) || 0,
            openInterest: Number(ctx.openInterest) || 0,
            minVlmUsd: staticMeta.minVlmUsd,
            minSize: staticMeta.minSize, // ADDED: Populate minSize from staticMeta
        });
    }

    return metaMap;
};

// ADDED: minSize to the COIN_META entries with suggested values
export const COIN_META: Record<string, { pxDecimals: number; minVlmUsd: number; minSize: number }> = {
    // Majors
    "BTC-PERP": { pxDecimals: 2, minVlmUsd: 10_000_000, minSize: 0.0001 },
    "ETH-PERP": { pxDecimals: 2, minVlmUsd: 5_000_000, minSize: 0.001 },
    "SOL-PERP": { pxDecimals: 2, minVlmUsd: 2_000_000, minSize: 0.01 },
    "LINK-PERP": { pxDecimals: 3, minVlmUsd: 1_000_000, minSize: 0.1 },

    // Mid-caps
    "ARB-PERP": { pxDecimals: 4, minVlmUsd: 1_000_000, minSize: 1 },
    "SUI-PERP": { pxDecimals: 4, minVlmUsd: 1_000_000, minSize: 1 },
    "SEI-PERP": { pxDecimals: 4, minVlmUsd: 500_000, minSize: 1 },
    "WLD-PERP": { pxDecimals: 4, minVlmUsd: 500_000, minSize: 1 },

    // Meme coins
    "DOGE-PERP": { pxDecimals: 5, minVlmUsd: 1_000_000, minSize: 5 },
    "XRP-PERP": { pxDecimals: 5, minVlmUsd: 1_000_000, minSize: 5 },
    "SHIB-PERP": { pxDecimals: 8, minVlmUsd: 500_000, minSize: 100000 },
    "PEPE-PERP": { pxDecimals: 8, minVlmUsd: 500_000, minSize: 100000 },
    "FLOKI-PERP": { pxDecimals: 8, minVlmUsd: 500_000, minSize: 100000 },
    "BONK-PERP": { pxDecimals: 8, minVlmUsd: 500_000, minSize: 100000 },
    "WIF-PERP": { pxDecimals: 5, minVlmUsd: 500_000, minSize: 1 },
    "HYPE-PERP": { pxDecimals: 3, minVlmUsd: 500_000, minSize: 1 },
};
