import { SUPPORTED_CHAINS, SupportedChain } from '@/app/WalletKit/walletKitSchema';

const base: SupportedChain = SUPPORTED_CHAINS.find((chain) => chain === 'Base') as 'Base';

export const ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS: Array<SupportedChain> = [base];
