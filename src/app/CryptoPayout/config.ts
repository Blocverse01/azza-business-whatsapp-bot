import { SUPPORTED_CHAINS, SupportedChain } from '@/app/WalletKit/walletKitSchema';
import env from '@/constants/env';

export const ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS: Array<SupportedChain> = [...SUPPORTED_CHAINS];

type Web3Environment = typeof env.WEB3_ENVIRONMENT;

export const PROJECT_WALLET_ADDRESS: {
    [key in Web3Environment]: string;
} = {
    testnet: '0x9645148C0ab80cb0A50635E3a0F8981ED1F1a091',
    mainnet: '0x60f50c703CAb09e9525c97AB921a6b5E1Aa87747',
};

export const getPayoutSpenderWalletAddress = (
    chain: SupportedChain,
    environment: Web3Environment
) => {
    return PROJECT_WALLET_ADDRESS[environment];
};
