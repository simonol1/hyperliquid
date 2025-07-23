import { logInfo, logError } from '../shared-utils/logger.js';
import type { Hyperliquid } from '../sdk/index.js';

export const placeTakeProfits = async (
    hyperliquid: Hyperliquid,
    coin: string,
    isLong: boolean,
    qty: number,
    entryPrice: number,
    _unusedInputPercents: number[], // ignored, using fixed wide-spaced values
    subaccountAddress: string,
    pxDecimals: number
) => {
    const takeProfitPercents = [2, 5, 10];           // ✅ Wide spacing
    const runnerPercent = 15;                        // 🏃 Final runner target

    const numLevels = takeProfitPercents.length;
    const finalChunkQty = Number((qty * 0.2).toFixed(4));
    const chunkQty = Number(((qty - finalChunkQty) / numLevels).toFixed(4));
    const placedPrices = new Set<number>();

    for (let i = 0; i < numLevels; i++) {
        const pct = takeProfitPercents[i];
        const rawPx = isLong
            ? entryPrice * (1 + pct / 100)
            : entryPrice * (1 - pct / 100);
        const tidyPx = Number(rawPx.toFixed(pxDecimals));

        if (placedPrices.has(tidyPx)) continue; // dedupe as safety net
        placedPrices.add(tidyPx);

        const res = await hyperliquid.exchange.placeOrder({
            coin,
            is_buy: !isLong,
            sz: chunkQty,
            limit_px: tidyPx,
            order_type: {
                trigger: { triggerPx: tidyPx, isMarket: true, tpsl: 'tp' },
            },
            reduce_only: true,
            vaultAddress: subaccountAddress,
            grouping: 'positionTpsl',
        });

        res.status === 'ok'
            ? logInfo(`[TP] ✅ Take profit @ ${tidyPx} for qty=${chunkQty}`)
            : logError(`[TP] ❌ Failed TP @ ${tidyPx}`);
    }

    // 🏃 Final 20% runner
    const runnerRawPx = isLong
        ? entryPrice * (1 + runnerPercent / 100)
        : entryPrice * (1 - runnerPercent / 100);
    const runnerPx = Number(runnerRawPx.toFixed(pxDecimals));

    const res = await hyperliquid.exchange.placeOrder({
        coin,
        is_buy: !isLong,
        sz: finalChunkQty,
        limit_px: runnerPx,
        order_type: {
            trigger: { triggerPx: runnerPx, isMarket: true, tpsl: 'tp' },
        },
        reduce_only: true,
        vaultAddress: subaccountAddress,
        grouping: 'positionTpsl',
    });

    res.status === 'ok'
        ? logInfo(`[TP] 🏃‍♂️ Runner take profit @ ${runnerPx} for qty=${finalChunkQty}`)
        : logError(`[TP] ❌ Failed runner TP @ ${runnerPx}`);
};
