import { BASE_CASHBACK_MEDIA_LINK, BASE_CASHBACK_REASON, SOLANA_CASHBACK_MEDIA_LINK, SOLANA_CASHBACK_REASON, CASHBACK_REFERENCE_PREFIX } from "@/constants/strings";
import type { CashBackChains, ChainPercentCashbackConfig } from "./types";
import { queues } from "@/background-processing/queues";
import { Queue } from "bullmq";
import { FeatureFlagKey } from "@/app/FeatureFlag/feature-flag-schema";

const BASE_CASHBACK_REFERENCE_PREFIX = `${CASHBACK_REFERENCE_PREFIX}base`;
const SOLANA_CASHBACK_REFERENCE_PREFIX = `${CASHBACK_REFERENCE_PREFIX}solana`;

const CHAIN_SPONSORED_CASHBACK_CONFIG: Record<CashBackChains, ChainPercentCashbackConfig> = {
    Base: {
        percentage: 1.5,
        assetId: 'usdc-base',
        referencePrefix: BASE_CASHBACK_REFERENCE_PREFIX,
        payoutWalletId: 'cashback-payout',
        payoutReason: BASE_CASHBACK_REASON,
        campaignBannerMedia: {
            link: BASE_CASHBACK_MEDIA_LINK
        },
        featureFlag: FeatureFlagKey.BASE_CASHBACK
    },
    Solana: {
        percentage: 1.5,
        assetId: 'usdc-solana',
        referencePrefix: SOLANA_CASHBACK_REFERENCE_PREFIX,
        payoutWalletId: 'cashback-payout',
        payoutReason: SOLANA_CASHBACK_REASON,
        campaignBannerMedia: {
            link: SOLANA_CASHBACK_MEDIA_LINK
        },
        featureFlag: FeatureFlagKey.SOLANA_CASHBACK
    }
}

export const getChainCashbackConfig = (chain: CashBackChains) => {
    return CHAIN_SPONSORED_CASHBACK_CONFIG[chain]
}

export const CASHBACK_QUEUES: Record<CashBackChains, Queue> = {
    Base: queues.baseCashback,
    Solana: queues.solanaCashback
}