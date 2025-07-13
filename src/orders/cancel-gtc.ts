import { logInfo, logError } from '../shared-utils/logger.js';
import type { Hyperliquid } from '../sdk/index.js';

export const cancelStaleGtc = async (
    hyperliquid: Hyperliquid,
    coin: string,
    subaccountAddress: string
) => {
    logInfo(`[Canceller] 🔎 Checking stale GTC for ${coin}`);

    const openOrders = await hyperliquid.info.getUserOpenOrders(subaccountAddress);
    const open = openOrders.find((o) => o.coin === coin);

    if (!open) {
        logInfo(`[Canceller] ✅ No GTC to cancel`);
        return;
    }

    const cancelRes = await hyperliquid.exchange.cancelOrder({ coin, o: open.oid });

    cancelRes.status === 'ok'
        ? logInfo(`[Canceller] 🗑️ Canceled GTC for ${coin} (oid=${open.oid})`)
        : logError(`[Canceller] ❌ Cancel failed for ${coin}`);
};
