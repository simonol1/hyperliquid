import { logInfo, logError, logExit } from '../shared-utils/logger.js';
import { stateManager } from '../shared-utils/state-manager.js';
import { placeOrderSafe } from '../orders/place-order-safe.js';
import type { Hyperliquid } from '../sdk/index.js';
import type { CoinMeta } from '../shared-utils/coin-meta.js';
import { checkRiskGuards } from '../shared-utils/risk-guards.js';
import { getTrackedPosition, updateTrackedPosition } from '../shared-utils/tracked-position.js';

export interface ExitIntent {
    quantity: number;
    price: number;
    type: 'SELL' | 'CLOSE' | 'EXIT';
    reason: string;
}

export const executeExit = async (
    hyperliquid: Hyperliquid,
    subaccountAddress: string,
    exitIntent: ExitIntent,
    coinMeta?: CoinMeta
) => {
    if (!coinMeta) {
        logError(`[ExecuteExit] ❌ No coin meta`);
        return;
    }

    const { coin, pxDecimals, szDecimals } = coinMeta;
    logInfo(`[ExecuteExit] Starting for ${coin} → ${exitIntent.reason}`);

    const tracked = await getTrackedPosition(coin);
    if (!tracked) {
        logError(`[ExecuteExit] ❌ No tracked position for ${coin}`);
        return;
    }

    const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
    const realPosition = perpState.assetPositions.find(
        (p) => p.position.coin === coin && Math.abs(parseFloat(p.position.szi)) > 0
    );

    if (!realPosition) {
        logInfo(`[ExecuteExit] ✅ Already flat ${coin}`);
        return;
    }

    const entryPx = parseFloat(realPosition.position.entryPx);
    const szi = parseFloat(realPosition.position.szi);
    const isShort = szi < 0;
    const rawQty = Math.abs(szi);

    // Determine if this is a final runner exit
    const allTPsHit = (tracked.takeProfitLevels?.length ?? 0) === (tracked.takeProfitHit?.length ?? 0);
    const isFinalRunnerExit = exitIntent.reason === 'TakeProfit hit' && allTPsHit;

    // Determine qty to close
    const qtyToClose = isFinalRunnerExit
        ? rawQty // exit full remaining position
        : rawQty * 0.333; // standard TP chunk

    const { canTrade, qty: safeQty } = await checkRiskGuards(
        hyperliquid,
        subaccountAddress,
        qtyToClose,
        exitIntent.price,
        coinMeta
    );

    if (!canTrade) {
        logInfo(`[ExecuteExit] Blocked by risk ${coin}`);
        return;
    }

    const tidyQty = Number(safeQty.toFixed(szDecimals));
    const exitSide = isShort ? 'BUY' : 'SELL';

    const book = await hyperliquid.info.getL2Book(coin);
    const [asks, bids] = book.levels;
    const px = isShort ? parseFloat(asks[0].px) * 1.0001 : parseFloat(bids[0].px) * 0.9999;
    const tidyPx = Number(px.toFixed(pxDecimals));

    const ok = await placeOrderSafe(
        hyperliquid,
        coin,
        exitSide === 'BUY',
        tidyQty,
        true,
        'Ioc',
        subaccountAddress,
        pxDecimals
    );

    if (!ok) {
        logError(`[ExecuteExit] ❌ Failed ${coin}`);
        return;
    }

    logExit({ asset: coin, price: tidyPx, reason: exitIntent.reason });

    const pnl = (tidyPx - entryPx) * tidyQty * (isShort ? -1 : 1);
    pnl < 0 ? stateManager.addLoss(Math.abs(pnl)) : stateManager.addProfit(pnl);

    logInfo(`[ExecuteExit] ✅ Closed ${coin} | PnL ${pnl.toFixed(2)}`);

    // Track take profit hits
    if (exitIntent.reason === 'TakeProfit hit') {
        const unhitLevels = (tracked.takeProfitLevels ?? []).filter(
            (level) => !(tracked.takeProfitHit ?? []).includes(level)
        );

        const nextHit = unhitLevels[0];
        if (nextHit !== undefined) {
            const updatedHits = new Set([...(tracked.takeProfitHit ?? []), nextHit]);
            await updateTrackedPosition(coin, { takeProfitHit: Array.from(updatedHits) });
        }
    } else if (exitIntent.reason === 'breakeven') {
        await updateTrackedPosition(coin, { breakevenTriggered: true });
    }
};
