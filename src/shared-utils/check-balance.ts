import type { Hyperliquid } from '../sdk/index';

/**
 * Checks available USD balance for the given vault.
 * Returns `true` if balance is above min threshold.
 */

export const hasMinimumBalance = async (
    hyperliquid: Hyperliquid,
    vaultAddress: string,
    minUsd = 10
): Promise<boolean> => {

    const perpState = await hyperliquid.info.perpetuals.getClearinghouseState(vaultAddress);
    const availableUsd = Number(perpState?.withdrawable) || 0;

    return availableUsd >= minUsd;
};
