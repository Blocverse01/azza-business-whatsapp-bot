import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import env from '@/constants/env';

const EXPLORER_URLS: {
    [key in SupportedChain]: {
        [key in 'testnet' | 'mainnet']: string;
    };
} = {
    Ethereum: {
        testnet: 'https://sepolia.etherscan.io',
        mainnet: 'https://etherscan.io',
    },
    Base: {
        testnet: 'https://sepolia.basescan.org',
        mainnet: 'https://basescan.org',
    },
    Polygon: {
        testnet: 'https://amoy.polygonscan.com',
        mainnet: 'https://polygonscan.com',
    },
    Optimism: {
        testnet: 'https://sepolia-optimism.etherscan.io',
        mainnet: 'https://optimistic.etherscan.io',
    },
};

export const getTransactionExplorerUrl = (
    txHash: string,
    chain: SupportedChain,
    environment = env.WEB3_ENVIRONMENT
) => {
    return `${EXPLORER_URLS[chain][environment]}/tx/${txHash}`;
};
