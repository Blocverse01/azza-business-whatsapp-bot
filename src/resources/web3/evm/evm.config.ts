import { ANKR_BASE_MAINNET_RPC_URL, ANKR_BASE_SEPOLIA_RPC_URL } from '@/constants/strings';
import { EvmCompatibleBlockchain } from '@/resources/web3/core/blockchains';
import { assetChainMainnet } from '@/resources/web3/evm/viem/chains';
import { Chain } from 'viem';
import {
    arbitrum,
    arbitrumSepolia,
    assetChainTestnet,
    base,
    baseSepolia,
    bsc,
    bscTestnet,
    mainnet,
    optimism,
    optimismSepolia,
    polygon,
    polygonAmoy,
    sepolia,
    lisk,
    liskSepolia,
    celo,
    celoAlfajores
} from 'viem/chains';

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
    | 'default-lisk-sepolia'
    | 'default-celo'
    | 'default-celo-alfajores'
    | 'default-asset-chain-testnet'
    | 'default-asset-chain-mainnet'
    | 'default-bsc-testnet'
    | 'default-bsc-mainnet' | 'default-arbitrum-mainnet' | 'default-arbitrum-testnet';

export type EvmNetworkConfig = {
    rpcUrl: string;
    key: EvmNode;
    network: EvmCompatibleBlockchain;
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

export const defaultAssetChainTestnet: EvmNetworkConfig = {
    rpcUrl: assetChainTestnet.rpcUrls['default'].http[0],
    key: 'default-asset-chain-testnet',
    network: 'AssetChain',
    viemChain: assetChainTestnet,
};
export const defaultAssetChainMainnet: EvmNetworkConfig = {
    rpcUrl: assetChainMainnet.rpcUrls['default'].http[0],
    key: 'default-asset-chain-mainnet',
    network: 'AssetChain',
    viemChain: assetChainMainnet,
};

export const defaultBscTestnet: EvmNetworkConfig = {
    rpcUrl: bscTestnet.rpcUrls['default'].http[0],
    key: 'default-bsc-testnet',
    network: 'Bep20',
    viemChain: bscTestnet,
};
export const defaultBscMainnet: EvmNetworkConfig = {
    rpcUrl: bsc.rpcUrls['default'].http[0],
    key: 'default-bsc-mainnet',
    network: 'Bep20',
    viemChain: bsc,
};
const defaultArbitrumMainnet: EvmNetworkConfig = {
    rpcUrl: arbitrum.rpcUrls['default'].http[0],
    key: 'default-arbitrum-mainnet',
    network: 'Arbitrum',
    viemChain: arbitrum
}
const defaultArbitrumTestnet: EvmNetworkConfig = {
    rpcUrl: arbitrumSepolia.rpcUrls['default'].http[0],
    key: 'default-arbitrum-testnet',
    network: 'Arbitrum',
    viemChain: arbitrumSepolia
}
export const defaultLiskSepolia: EvmNetworkConfig = {
    rpcUrl: liskSepolia.rpcUrls['default'].http[0],
    key: 'default-lisk-sepolia',
    network: 'Lisk',
    viemChain: liskSepolia,
};

export const defaultLisk: EvmNetworkConfig = {
    rpcUrl: lisk.rpcUrls['default'].http[0],
    key: 'default-lisk',
    network: 'Lisk',
    viemChain: lisk,
};
export const defaultCelo: EvmNetworkConfig = {
    rpcUrl: lisk.rpcUrls['default'].http[0],
    key: 'default-celo',
    network: 'Celo',
    viemChain: celo,
};
export const defaultCeloAlfajores: EvmNetworkConfig = {
    rpcUrl: lisk.rpcUrls['default'].http[0],
    key: 'default-celo-alfajores',
    network: 'Celo',
    viemChain: celoAlfajores,
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
    AssetChain: {
        mainnet: defaultAssetChainMainnet,
        testnet: defaultAssetChainTestnet,
    },
    Bep20: {
        mainnet: defaultBscMainnet,
        testnet: defaultBscTestnet,
    },
    Arbitrum: {
        mainnet: defaultArbitrumMainnet,
        testnet: defaultArbitrumTestnet
    },
    Lisk: {
        mainnet: defaultLisk,
        testnet: defaultLiskSepolia,
    },
    Celo: {
        mainnet: defaultCelo,
        testnet: defaultCeloAlfajores,
    }
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
