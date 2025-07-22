import type { Hyperliquid } from '../sdk/index';
import { logDebug, logInfo } from './logger';

export const MIN_BALANCE_USD = 20

/**
 * Checks available USD balance for the given vault.
 * Returns `true` if balance is above min threshold.
 */

export const hasMinimumBalance = async (
    hyperliquid: Hyperliquid,
    subaccountAddress: string,
): Promise<boolean> => {

    const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
    logInfo(`<--------- perpState: ${JSON.stringify(perpState)} ------->`)
    const availableUsd = Number(perpState) || 0;

    logInfo(`[BalanceCheck] Available USD=${availableUsd}, Min Threshold=${MIN_BALANCE_USD}`);

    return availableUsd >= MIN_BALANCE_USD;
};
