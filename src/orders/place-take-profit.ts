import { logInfo, logError } from '../shared-utils/logger.js';
import type { Hyperliquid } from '../sdk/index.js';

export const placeTakeProfit = async (
    hyperliquid: Hyperliquid,
    coin: string,
    isLong: boolean,
    qty: number,
    entryPrice: number,
    takeProfitPct: number,
    subaccountAddress: string,
    pxDecimals: number
) => {
    const targetPx = isLong
        ? entryPrice * (1 + takeProfitPct / 100)
        : entryPrice * (1 - takeProfitPct / 100);
    const tidyPx = Number(targetPx.toFixed(pxDecimals));

    const res = await hyperliquid.exchange.placeOrder({
        coin,
        is_buy: !isLong,
        sz: qty,
        limit_px: tidyPx,
        order_type: {
            trigger: { triggerPx: tidyPx, isMarket: true, tpsl: 'tp' },
        },
        reduce_only: true,
        vaultAddress: subaccountAddress,
        grouping: 'positionTpsl',
    });

    res.status === 'ok'
        ? logInfo(`[TP] ✅ Take profit @ ${tidyPx}`)
        : logError(`[TP] ❌ Failed TP @ ${tidyPx}`);
};
