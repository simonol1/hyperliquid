import type { Hyperliquid } from '../sdk/index';

/**
 * Checks available USD balance for the given vault.
 * Returns `true` if balance is above min threshold.
 */

export const hasMinimumBalance = async (
    hyperliquid: Hyperliquid,
    subaccountAddress: string,
    minUsd = 10
): Promise<boolean> => {

    const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(subaccountAddress);
    const availableUsd = Number(perpState?.withdrawable) || 0;

    return availableUsd >= minUsd;
};
