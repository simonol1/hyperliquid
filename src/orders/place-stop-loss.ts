import { logInfo, logError } from '../shared-utils/logger.js';
import type { Hyperliquid, OrderRequest } from '../sdk/index.js';
import { retryWithBackoff } from '../shared-utils/retry-order.js';

export const placeStopLoss = async (
    hyperliquid: Hyperliquid,
    coin: string,
    isLong: boolean,
    qty: number,
    entryPx: number,
    stopLossPct: number,
    pxDecimals: number
) => {
    const stopPx = isLong
        ? entryPx * (1 - stopLossPct / 100)
        : entryPx * (1 + stopLossPct / 100);
    const stopPxTidy = Number(stopPx.toFixed(pxDecimals));

    const triggerOrder: OrderRequest = {
        coin,
        is_buy: !isLong,
        sz: qty,
        limit_px: stopPxTidy,
        order_type: {
            trigger: { triggerPx: stopPxTidy, isMarket: true, tpsl: 'sl' as const },
        },
        reduce_only: true,
        grouping: 'positionTpsl',
    };

    const res = await retryWithBackoff(
        () => hyperliquid.exchange.placeOrder(triggerOrder),
        3,
        1000,
        2,
        `Stop Loss @ ${stopPxTidy}`
    );

    if (res?.status === 'ok') {
        logInfo(`[StopLoss] 🛑 Placed ${coin} SL @ ${stopPxTidy}`);
    } else {
        logError(`[StopLoss] ❌ Failed to place SL for ${coin} @ ${stopPxTidy} → ${JSON.stringify(res)}`);
    }
};
