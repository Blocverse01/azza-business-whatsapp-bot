import env from '@/constants/env';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';

const SOLANA_TESTNET_CLUSTER = 'devnet';

const EXPLORER_URLS: {
    [key in AllSupportedBlockchains]: {
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
    Tron: {
        testnet: 'https://shasta.tronscan.org',
        mainnet: 'https://tronscan.org',
    },
    Bep20: {
        testnet: 'https://testnet.bscscan.com',
        mainnet: 'https://bscscan.com',
    },
    Solana: {
        testnet: 'https://explorer.solana.com',
        mainnet: 'https://explorer.solana.com',
    },
    AssetChain: {
        testnet: 'https://scan-testnet.assetchain.org',
        mainnet: 'https://scan.assetchain.org',
    },
    Arbitrum: {
        testnet: 'https://sepolia.arbiscan.io/',
        mainnet: 'https://arbiscan.io/',
    },
    Lisk: {
        testnet: 'https://sepolia-blockscout.lisk.com/',
        mainnet: 'https://blockscout.lisk.com/',
    },
    Celo: {
        testnet: 'https://alfajores.celoscan.io/',
        mainnet: 'https://celoscan.io/',
    },
};

export const getTransactionExplorerUrl = (
    txHash: string,
    chain: AllSupportedBlockchains,
    environment = env.WEB3_ENVIRONMENT
) => {
    switch (chain) {
        case 'Tron':
            return `${EXPLORER_URLS[chain][environment]}/#/transaction/${txHash}`;
        case 'Solana':
            return `${EXPLORER_URLS[chain][environment]}/tx/${txHash}${environment === 'testnet' ? `?cluster=${SOLANA_TESTNET_CLUSTER}` : ''}`;
        default:
            return `${EXPLORER_URLS[chain][environment]}/tx/${txHash}`;
    }
};
