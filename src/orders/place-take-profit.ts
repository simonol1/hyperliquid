import { logInfo, logError } from '../shared-utils/logger.js';
import type { Hyperliquid } from '../sdk/index.js';

export const placeTakeProfits = async (
    hyperliquid: Hyperliquid,
    coin: string,
    isLong: boolean,
    qty: number,
    entryPrice: number,
    takeProfitPercents: number[],
    subaccountAddress: string,
    pxDecimals: number
) => {
    const chunkSize = qty / takeProfitPercents.length;

    for (const tpPct of takeProfitPercents) {
        const targetPx = isLong
            ? entryPrice * (1 + tpPct / 100)
            : entryPrice * (1 - tpPct / 100);
        const tidyPx = Number(targetPx.toFixed(pxDecimals));
        const tidyQty = Number(chunkSize.toFixed(4));

        const res = await hyperliquid.exchange.placeOrder({
            coin,
            is_buy: !isLong,
            sz: tidyQty,
            limit_px: tidyPx,
            order_type: {
                trigger: { triggerPx: tidyPx, isMarket: true, tpsl: 'tp' },
            },
            reduce_only: true,
            vaultAddress: subaccountAddress,
            grouping: 'positionTpsl',
        });

        res.status === 'ok'
            ? logInfo(`[TP] ✅ Take profit @ ${tidyPx} for qty=${tidyQty}`)
            : logError(`[TP] ❌ Failed TP @ ${tidyPx}`);
    }
};