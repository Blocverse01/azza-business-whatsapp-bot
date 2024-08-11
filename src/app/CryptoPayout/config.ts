import { SUPPORTED_CHAINS, SupportedChain } from '@/app/WalletKit/walletKitSchema';
import env from '@/constants/env';

const base: SupportedChain = SUPPORTED_CHAINS.find((chain) => chain === 'Base') as 'Base';

export const ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS: Array<SupportedChain> = [base];

type Web3Environment = typeof env.WEB3_ENVIRONMENT;

export const WALLET_ADDRESSES: {
    [key in SupportedChain]?: {
        [key in Web3Environment]: string;
    };
} = {
    Base: {
        testnet: '0x9645148C0ab80cb0A50635E3a0F8981ED1F1a091',
        mainnet: '0x60f50c703CAb09e9525c97AB921a6b5E1Aa87747',
    },
};

export const getPayoutSpenderWalletAddress = (
    chain: SupportedChain,
    environment: Web3Environment
) => {
    return WALLET_ADDRESSES[chain]?.[environment];
};
