import { z } from 'zod';

export const EVM_BLOCKCHAINS = [
    'Base',
    'Optimism',
    'Polygon',
    'Ethereum',
    'Bep20',
    'AssetChain',
    'Arbitrum',
    'Lisk',
    'Celo'
] as const;
export const NON_EVM_BLOCKCHAINS = ['Solana', 'Tron'] as const;
export const SUPPORTED_BLOCKCHAINS = [...EVM_BLOCKCHAINS, ...NON_EVM_BLOCKCHAINS] as const;

export const supportedBlockchainChainSchema = z.enum(SUPPORTED_BLOCKCHAINS);
const evmChainSchema = z.enum(EVM_BLOCKCHAINS);
const nonEvmChainSchema = z.enum(NON_EVM_BLOCKCHAINS);

export type AllSupportedBlockchains = z.infer<typeof supportedBlockchainChainSchema>;
export type EvmCompatibleBlockchain = z.infer<typeof evmChainSchema>;
export type NonCompatibleBlockchain = z.infer<typeof nonEvmChainSchema>;

export const normalizeBlockchainInput = (network: string): AllSupportedBlockchains => {
    const normalizedNetwork = SUPPORTED_BLOCKCHAINS.find(
        (chain) => chain.toLowerCase() === network.toLowerCase()
    );
    if (normalizedNetwork) {
        return normalizedNetwork;
    }
    throw new Error(`Unsupported blockchain network: ${network}`);
};

export const isEvmCompatibleBlockchain = (
    network: AllSupportedBlockchains
): network is EvmCompatibleBlockchain => {
    return evmChainSchema.safeParse(network).success;
};
export const isNonEvmCompatibleBlockchain = (
    network: AllSupportedBlockchains
): network is NonCompatibleBlockchain => {
    return nonEvmChainSchema.safeParse(network).success;
};
export const isValidBlockchain = (network: string): network is AllSupportedBlockchains => {
    return supportedBlockchainChainSchema.safeParse(normalizeBlockchainInput(network)).success;
};
