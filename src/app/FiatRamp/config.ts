import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';

export const ONRAMP_MINIMUM_BY_CHAIN: Partial<Record<AllSupportedBlockchains, number>> = {
    Tron: 29,
};

export const OFFRAMP_MINIMUM_BY_CHAIN: Partial<Record<AllSupportedBlockchains, number>> = {
    Tron: 29,
};

export const getMinimumOnrampUsdAmount = (chain: AllSupportedBlockchains): number | null => {
    return ONRAMP_MINIMUM_BY_CHAIN[chain] ?? null;
};
export const getMinimumOfframpUsdAmount = (chain: AllSupportedBlockchains): number | null => {
    return OFFRAMP_MINIMUM_BY_CHAIN[chain] ?? null;
};

export const SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID = 'safehaven' as const;
export const MANUAL_OFFRAMP_PAYMENT_PROCESSOR_ID = 'mp' as const;

export type ProcessorId =
    | typeof SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID
    | typeof MANUAL_OFFRAMP_PAYMENT_PROCESSOR_ID;
