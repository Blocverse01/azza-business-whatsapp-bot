import { FeatureFlagKey } from "@/app/FeatureFlag/feature-flag-schema";
import { AllSupportedBlockchains } from "@/resources/web3/core/blockchains";

export type PercentageCashbackParams = {
    tradeAmountUsd: number;
    userWalletAddress: string;
    targetTransactionHash: string;
    cashbackPercentage: number;
    assetId: string;
    payoutReference: string;
    payoutWalletId: string;
    payoutReason: string;
};

export type CashBackChains = Extract<AllSupportedBlockchains, 'Base' | 'Solana'>

export type PercentageCashbackQueueInput = {
    transactionId: string;
    transactionType: 'offramp' | 'onramp' | 'manual-offramp' | 'ngn-bank-offramp' | 'honey-coin-offramp';
};
export type ChainPercentCashbackConfig = {
    percentage: number;
    assetId: string; // usually a USD-pegged asset, because the cashback is a percent of the volume traded (in usd).
    referencePrefix: string;
    payoutWalletId: string;
    payoutReason: string;
    campaignBannerMedia: {
        id?: string;
        link?: string;
    }
    featureFlag: FeatureFlagKey;
}
