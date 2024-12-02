import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { Chain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { ANKR_BASE_MAINNET_RPC_URL, ANKR_BASE_SEPOLIA_RPC_URL } from '@/constants/strings';

export type EvmNode = 'ankr-base-mainnet' | 'ankr-base-sepolia';

export type EvmNetworkConfig = {
    rpcUrl: string;
    key: EvmNode;
    network: SupportedChain;
    viemChain: Chain;
};

export const ankrBaseMainnet: EvmNetworkConfig = {
    rpcUrl: ANKR_BASE_MAINNET_RPC_URL,
    key: 'ankr-base-mainnet',
    network: 'Base',
    viemChain: base,
};
export const ankrBaseSepolia: EvmNetworkConfig = {
    rpcUrl: ANKR_BASE_SEPOLIA_RPC_URL,
    key: 'ankr-base-sepolia',
    network: 'Base',
    viemChain: baseSepolia,
};

const APP_DEFAULT_EVM_NETWORK_CONFIGS: Partial<
    Record<SupportedChain, Record<'testnet' | 'mainnet', EvmNetworkConfig>>
> = {
    Base: {
        mainnet: ankrBaseMainnet,
        testnet: ankrBaseSepolia,
    },
};

export const getAppDefaultEvmConfig = (
    network: SupportedChain,
    environment: 'testnet' | 'mainnet'
): EvmNetworkConfig => {
    const config = APP_DEFAULT_EVM_NETWORK_CONFIGS[network];

    if (!config) {
        throw new Error(`No default EVM network config found for network: ${network}`);
    }

    return config[environment];
};
