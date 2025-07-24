import { logInfo, logError } from '../shared-utils/logger.js';
import type { Hyperliquid, OrderRequest } from '../sdk/index.js';
import { retryWithBackoff } from '../shared-utils/retry-order.js';

export const placeTakeProfits = async (
    hyperliquid: Hyperliquid,
    coin: string,
    isLong: boolean,
    qty: number,
    entryPrice: number,
    takeProfitPercents: number[],
    runnerTargetPercent: number,
    pxDecimals: number
) => {
    const numLevels = takeProfitPercents.length;
    const finalChunkQty = Number((qty * 0.2).toFixed(4));
    const chunkQty = Number(((qty - finalChunkQty) / numLevels).toFixed(4));
    const placedPrices = new Set<number>();

    for (const pct of takeProfitPercents) {
        const rawPx = isLong
            ? entryPrice * (1 + pct / 100)
            : entryPrice * (1 - pct / 100);
        const tidyPx = Number(rawPx.toFixed(pxDecimals));
        if (placedPrices.has(tidyPx)) continue;
        placedPrices.add(tidyPx);

        const orderParams: OrderRequest = {
            coin,
            is_buy: !isLong,
            sz: chunkQty,
            limit_px: tidyPx,
            order_type: {
                trigger: { triggerPx: tidyPx, isMarket: true, tpsl: 'tp' as const },
            },
            reduce_only: true,
            grouping: 'positionTpsl',
        };

        const result = await retryWithBackoff(
            () => hyperliquid.exchange.placeOrder(orderParams),
            3,
            1000,
            2,
            `TP @ ${tidyPx}`
        );

        result?.status === 'ok'
            ? logInfo(`[TP] ✅ Take profit @ ${tidyPx} for qty=${chunkQty}`)
            : logError(`[TP] ❌ Failed TP @ ${tidyPx}`);
    }

    // 🏃 Final 20% runner
    const runnerRawPx = isLong
        ? entryPrice * (1 + runnerTargetPercent / 100)
        : entryPrice * (1 - runnerTargetPercent / 100);
    const runnerPx = Number(runnerRawPx.toFixed(pxDecimals));

    const runnerParams: OrderRequest = {
        coin,
        is_buy: !isLong,
        sz: finalChunkQty,
        limit_px: runnerPx,
        order_type: {
            trigger: { triggerPx: runnerPx, isMarket: true, tpsl: 'tp' as const },
        },
        reduce_only: true,
        grouping: 'positionTpsl',
    };

    const runnerRes = await retryWithBackoff(
        () => hyperliquid.exchange.placeOrder(runnerParams),
        3,
        1000,
        2,
        `Runner TP @ ${runnerPx}`
    );

    runnerRes?.status === 'ok'
        ? logInfo(`[TP] 🏃‍♂️ Runner take profit @ ${runnerPx} for qty=${finalChunkQty}`)
        : logError(`[TP] ❌ Failed runner TP @ ${runnerPx}`);
};
