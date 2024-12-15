import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import env from '@/constants/env';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';

const SOLANA_TESTNET_CLUSTER = 'devnet';

const EXPLORER_URLS: {
    [key in SupportedChain | ExtendedWalletSupportedNetworks]: {
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
};

export const getTransactionExplorerUrl = (
    txHash: string,
    chain: SupportedChain | ExtendedWalletSupportedNetworks,
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
