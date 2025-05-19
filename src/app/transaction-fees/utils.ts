import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import cryptoAssetPriceService from '@/runtime/crypto-asset-price';
import azzaWalletManager from '@/runtime/wallet';

type WithdrawalNetworkFeeCalculatorParams = {
    assetId: string;
    userId: string;
    recipient: string;
    amount: number;
};

const NATIVE_ASSET_TOKEN_SYMBOLS: Record<AllSupportedBlockchains, string> = {
    Polygon: 'POL',
    Base: 'ETH',
    Bep20: 'BNB',
    Optimism: 'ETH',
    Solana: 'SOL',
    Ethereum: 'ETH',
    Lisk: 'ETH',
    Celo: 'ETH',
    AssetChain: 'RWA',
    Tron: 'TRX',
    Arbitrum: 'ETH',
};

// Get the network fee for a withdrawal and charge it in the token the user wants to withdraw.
export const calculateWithdrawalFees = async (params: WithdrawalNetworkFeeCalculatorParams) => {
    const FEE_OVERESTIMATE_MULTIPLIER = 1.02;
    const PLATFORM_FEE_PERCENTAGE = 0.002;

    const assetConfig = getAssetConfigOrThrow(params.assetId);

    const [networkFeeInfo, nativeTokenUsdPrice, assetToWithdrawUsdPrice] = await Promise.all([
        azzaWalletManager.getWithdrawNetworkFee({
            amount: params.amount.toString(),
            assetId: params.assetId,
            recipient: params.recipient,
            userId: params.userId,
        }),
        cryptoAssetPriceService.getAssetPrice(
            NATIVE_ASSET_TOKEN_SYMBOLS[assetConfig.network],
            'USD'
        ),
        cryptoAssetPriceService.getAssetPrice(assetConfig.tokenName, 'USD'),
    ]);

    const rawFeeUsdValue = networkFeeInfo.networkFee * nativeTokenUsdPrice;
    const feeUsdValue = rawFeeUsdValue * FEE_OVERESTIMATE_MULTIPLIER;

    if (assetConfig.isNative) {
        const platformFee = params.amount * PLATFORM_FEE_PERCENTAGE;
        const totalFee = networkFeeInfo.networkFee * FEE_OVERESTIMATE_MULTIPLIER + platformFee;

        return {
            networkFee: networkFeeInfo.networkFee * FEE_OVERESTIMATE_MULTIPLIER,
            networkFeeUsd: feeUsdValue,
            platformFee,
            totalFee,
        };
    }

    const feeInAssetToWithdraw = feeUsdValue / assetToWithdrawUsdPrice;
    const platformFee = params.amount * PLATFORM_FEE_PERCENTAGE;
    const totalFee = feeInAssetToWithdraw + platformFee;

    return {
        networkFee: feeInAssetToWithdraw,
        networkFeeUsd: feeUsdValue,
        platformFee,
        totalFee,
    };
};
