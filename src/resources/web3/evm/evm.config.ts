import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { Chain } from 'viem';
import {
    base,
    baseSepolia,
    lisk,
    mainnet,
    optimism,
    optimismSepolia,
    polygon,
    polygonAmoy,
    sepolia,
} from 'viem/chains';
import { ANKR_BASE_MAINNET_RPC_URL, ANKR_BASE_SEPOLIA_RPC_URL } from '@/constants/strings';

export type EvmNetwork = Exclude<SupportedChain, 'Solana'>;
export type EvmNode =
    | 'ankr-base-mainnet'
    | 'ankr-base-sepolia'
    | 'default-optimism-sepolia'
    | 'default-optimism-mainnet'
    | 'default-polygon'
    | 'default-polygon-amoy'
    | 'default-ethereum'
    | 'default-ethereum-sepolia'
    | 'default-lisk'
    | 'default-lisk-sepolia';

export type EvmNetworkConfig = {
    rpcUrl: string;
    key: EvmNode;
    network: EvmNetwork;
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

export const defaultOptimismSepolia: EvmNetworkConfig = {
    rpcUrl: optimismSepolia.rpcUrls['default'].http[0],
    key: 'default-optimism-sepolia',
    network: 'Base',
    viemChain: baseSepolia,
};

export const defaultOptimism: EvmNetworkConfig = {
    rpcUrl: optimism.rpcUrls['default'].http[0],
    key: 'default-optimism-mainnet',
    network: 'Optimism',
    viemChain: optimism,
};

export const defaultPolygon: EvmNetworkConfig = {
    rpcUrl: polygon.rpcUrls['default'].http[0],
    key: 'default-polygon',
    network: 'Polygon',
    viemChain: polygon,
};

export const defaultPolygonAmoy: EvmNetworkConfig = {
    rpcUrl: polygonAmoy.rpcUrls['default'].http[0],
    key: 'default-polygon-amoy',
    network: 'Polygon',
    viemChain: polygonAmoy,
};

export const defaultEthereum: EvmNetworkConfig = {
    rpcUrl: mainnet.rpcUrls['default'].http[0],
    key: 'default-ethereum',
    network: 'Ethereum',
    viemChain: mainnet,
};

export const defaultEthereumSepolia: EvmNetworkConfig = {
    rpcUrl: sepolia.rpcUrls['default'].http[0],
    key: 'default-ethereum-sepolia',
    network: 'Ethereum',
    viemChain: sepolia,
};

const APP_DEFAULT_EVM_NETWORK_CONFIGS: Record<
    EvmNetworkConfig['network'],
    Record<'testnet' | 'mainnet', EvmNetworkConfig>
> = {
    Base: {
        mainnet: ankrBaseMainnet,
        testnet: ankrBaseSepolia,
    },
    Optimism: {
        mainnet: defaultOptimism,
        testnet: defaultOptimismSepolia,
    },
    Polygon: {
        mainnet: defaultPolygon,
        testnet: defaultPolygonAmoy,
    },
    Ethereum: {
        mainnet: defaultEthereum,
        testnet: defaultEthereumSepolia,
    },
};

export const getAppDefaultEvmConfig = (
    network: EvmNetworkConfig['network'],
    environment: 'testnet' | 'mainnet'
): EvmNetworkConfig => {
    const config = APP_DEFAULT_EVM_NETWORK_CONFIGS[network];

    if (!config) {
        throw new Error(`No default EVM network config found for network: ${network}`);
    }

    return config[environment];
};
