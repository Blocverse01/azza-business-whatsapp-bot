import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';

export const ONRAMP_MINIMUM_BY_CHAIN: Partial<Record<AllSupportedBlockchains, number>> = {
    Tron: 999,
};

export const OFFRAMP_MINIMUM_BY_CHAIN: Partial<Record<AllSupportedBlockchains, number>> = {
    Tron: 999,
};

export const getMinimumOnrampUsdAmount = (chain: AllSupportedBlockchains): number | null => {
    return ONRAMP_MINIMUM_BY_CHAIN[chain] ?? null;
};
export const getMinimumOfframpUsdAmount = (chain: AllSupportedBlockchains): number | null => {
    return OFFRAMP_MINIMUM_BY_CHAIN[chain] ?? null;
};
