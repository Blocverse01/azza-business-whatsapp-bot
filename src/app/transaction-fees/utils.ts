import { getMasterWalletClient } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import { dbClient } from '@/db/dbClient';
import { TransactionFeeLogsRecord } from '@/db/xata';
import { decimalToString } from '@/resources/utils/currency';
import { tryOrNull } from '@/resources/utils/failsafe';
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
    const nativeAssetConfig = azzaWalletManager.searchAssets({
        tokenName: NATIVE_ASSET_TOKEN_SYMBOLS[assetConfig.network],
        network: assetConfig.network,
    })[0];

    const [
        networkFeeInfo,
        nativeAssetUsdPrice,
        assetToWithdrawUsdPrice,
        nativeAssetToWithdrawAssetRateQuote,
    ] = await Promise.all([
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
        nativeAssetConfig && !assetConfig.isNative
            ? tryOrNull(
                  azzaWalletManager.getSwapQuote({
                      fromAssetId: nativeAssetConfig.listItemId,
                      toAssetId: params.assetId,
                      amount: params.amount.toString(),
                      userId: params.userId,
                  })
              )
            : Promise.resolve(null),
    ]);

    const rawFeeUsdValue = networkFeeInfo.networkFeeInUsd;
    const feeUsdValue = rawFeeUsdValue * FEE_OVERESTIMATE_MULTIPLIER;

    const platformFee = params.amount * PLATFORM_FEE_PERCENTAGE;

    if (assetConfig.isNative) {
        const overestimatedNetworkFee = networkFeeInfo.networkFee * FEE_OVERESTIMATE_MULTIPLIER;
        const totalFee = overestimatedNetworkFee + platformFee;
        const totalFeeUsd =
            rawFeeUsdValue * FEE_OVERESTIMATE_MULTIPLIER + platformFee * nativeAssetUsdPrice;

        return {
            networkFee: overestimatedNetworkFee,
            networkFeeUsd: feeUsdValue,
            platformFee,
            totalFee,
            totalFeeUsd,
        };
    }

    // For non-native asset
    const feeInAssetToWithdraw = (() => {
        if (assetToWithdrawUsdPrice > 0) {
            return feeUsdValue / assetToWithdrawUsdPrice;
        }
        if (nativeAssetToWithdrawAssetRateQuote) {
            return networkFeeInfo.networkFee / nativeAssetToWithdrawAssetRateQuote.rate;
        }
        // If we can't determine the fee in the asset to withdraw, we return 0
        return 0;
    })();

    const totalFee = feeInAssetToWithdraw + platformFee;
    const totalFeeUsd = feeUsdValue + platformFee * assetToWithdrawUsdPrice;

    return {
        networkFee: feeInAssetToWithdraw,
        networkFeeUsd: feeUsdValue,
        platformFee,
        totalFee,
        totalFeeUsd,
    };
};

export const getDeterministicIdFromTxReference = (txReference: string) => {
    return `fee_${txReference}`;
};

export const recordTransactionFeeCharge = async (params: {
    amount: number;
    assetId: string;
    userId: string;
    txReference: string;
    amountUsd: number;
    transactionType: 'withdrawal' | 'swap';
}) => {
    const deterministicId = getDeterministicIdFromTxReference(params.txReference);
    await dbClient.transaction_fee_logs.create(deterministicId, {
        assetId: params.assetId,
        userId: params.userId,
        tokenAmount: params.amount,
        usdAmount: params.amountUsd,
        transactionType: params.transactionType,
    });
};

export const getPendingTransactionFeeLogs = async (userId: string, assetId: string) => {
    return await dbClient.transaction_fee_logs
        .filter({
            assetId: assetId,
            userId: userId,
            status: {
                $isNot: 'collected',
            },
        })
        .getAll();
};

export const aggregatePendingTransactionFeeTokenAmount = async (
    userId: string,
    assetId: string
) => {
    const logs = await getPendingTransactionFeeLogs(userId, assetId);
    return logs.reduce((acc, log) => acc + log.tokenAmount, 0);
};

export const getTransactionFeeLogById = async (feeLogId: string) => {
    return await dbClient.transaction_fee_logs.read(feeLogId);
};

export const collectTransactionFee = async (transactionFeeLog: TransactionFeeLogsRecord) => {
    const { tokenAmount, assetId, userId, status } = transactionFeeLog;

    if (status === 'collected') {
        return;
    }

    const assetConfig = getAssetConfigOrThrow(assetId);
    const masterWalletClient = getMasterWalletClient(assetConfig.network);

    return await azzaWalletManager.withdrawAsset({
        assetId,
        userId,
        recipient: masterWalletClient.walletAddress,
        amount: decimalToString(tokenAmount),
        reference: transactionFeeLog.id,
        metadata: {
            reason: 'fee_collection',
        },
    });
};
