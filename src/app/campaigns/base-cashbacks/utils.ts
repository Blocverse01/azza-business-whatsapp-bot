import { HUNDRED, ONE } from '@/constants/numbers';
import { PercentageCashbackParams, PercentageCashbackQueueInput } from './types';
import * as math from 'mathjs';
import platformWalletManager from '@/runtime/platform-wallets';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import { TokenNames } from '@/resources/web3/core/tokens';
import crypto from 'node:crypto';
import { BASE_CASHBACK_REASON, BASE_CASHBACK_REFERENCE_PREFIX } from '@/constants/strings';
import { queues } from '@/background-processing/queues';
import { QueueNames } from '@/background-processing/types';
import { Worker } from 'bullmq';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import azzaWalletManager from '@/runtime/wallet';
import { PhoneNumberParams } from '@/app/WhatsAppBot/WhatsAppBotType';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import ManualOfframpSettlementService from '@/app/FiatRamp/alternatives/ManualOfframpSettlementService';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import logger from '@/resources/logger';
import SafeHavenService from '@/app/SafeHaven/SafeHavenService';

const CASHBACK_PAYOUT_WALLET_USER_ID = 'cashback-payout';
const BASE_CASHBACK_BANNER_MEDIA_ID = '1103964578170380';

const generateTransactionReferenceId = (targetTransactionHash: string) => {
    const txHashSha256 = crypto.createHash('sha256').update(targetTransactionHash).digest('hex');
    const relevantParts = txHashSha256.slice(0, 16) + txHashSha256.slice(-8);
    return `${BASE_CASHBACK_REFERENCE_PREFIX}${relevantParts}`;
};

export const processBaseCashback = async (params: PercentageCashbackParams) => {
    const convertedPercentage = math.divide(params.cashbackPercentage, HUNDRED);
    const cashbackAmountUsd = math.fix(
        math.multiply(params.tradeAmountUsd, convertedPercentage),
        6
    );
    const asset = getAssetConfigOrThrow(params.assetId);

    if (asset.network !== 'Base' && asset.tokenName !== TokenNames.USDC) {
        throw new Error('This cashback is only supported for USDC on Base network');
    }

    return await platformWalletManager.withdrawAsset({
        assetId: params.assetId,
        userId: CASHBACK_PAYOUT_WALLET_USER_ID,
        amount: cashbackAmountUsd.toString(),
        recipient: params.userWalletAddress,
        reference: generateTransactionReferenceId(params.targetTransactionHash),
        metadata: {
            reason: BASE_CASHBACK_REASON,
        },
    });
};

export const addCashbackJobToQueue = async (input: PercentageCashbackQueueInput) => {
    const featureIsEnabled = await FeatureFlagService.isFeatureEnabled(
        FeatureFlagKey.BASE_CASHBACK
    );
    if (!featureIsEnabled) {
        return;
    }
    const jobId = `base-cashback-${input.transactionId}`;
    return queues.baseCashback.add(jobId, input, {
        jobId,
        removeOnComplete: false,
    });
};

export const createBaseCashbackWorker = () => {
    return new Worker<PercentageCashbackQueueInput>(
        QueueNames.baseCashback,
        async (job) => {
            const { transactionId, transactionType } = job.data;

            const transaction = await (async () => {
                if (transactionType === 'manual-offramp') {
                    return await ManualOfframpSettlementService.getManualOfframpSettlementBySequenceId(
                        transactionId
                    );
                }
                if (transactionType === 'safehaven-offramp') {
                    return await SafeHavenService.getSafeHavenOfframpTransactionBySequenceId(
                        transactionId
                    );
                }
                if (transactionType === 'offramp') {
                    return await FiatRampService.getOfframpTransaction(transactionId);
                }
                if (transactionType === 'onramp') {
                    return await FiatRampService.getOnrampTransaction(transactionId);
                }
                throw new Error(`Invalid transaction type: ${transactionType}`);
            })();

            if (!transaction) {
                throw Error(`Transaction with ID ${transactionId} not found`);
            }

            const transactionUsdAmount = transaction.usdAmount!;
            const assetConfig = azzaWalletManager.searchAssets({
                tokenName: transaction.tokenSymbol!,
                network: transaction.blockchainNetwork!,
            })[0];
            const destinationWalletAddress =
                'fromWalletAddress' in transaction
                    ? transaction.fromWalletAddress
                    : transaction.destinationWalletAddress;

            if (!destinationWalletAddress) {
                throw Error(`Target transaction doesn't include a valid destination address`);
            }

            if (!transaction.sequenceId) {
                throw Error('Missing sequenceId');
            }

            const cashbackParams: PercentageCashbackParams = {
                tradeAmountUsd: transactionUsdAmount,
                userWalletAddress: destinationWalletAddress,
                targetTransactionHash: transaction.sequenceId,
                cashbackPercentage: ONE,
                assetId: assetConfig.listItemId,
            };

            try {
                return await processBaseCashback(cashbackParams);
            } catch (error) {
                const parsedError = parseUnknownError(error);
                await logger.error(parsedError.message, {
                    error: parsedError,
                });

                throw error;
            }
        },
        {
            connection: connectionConfig,
            concurrency: 5,
        }
    );
};

export const sendDepositMessageWithCashbackBanner = async (
    message: string,
    phoneParams: PhoneNumberParams
) => {
    return await WhatsAppBotService.sendMediaMessage(phoneParams, {
        mediaId: BASE_CASHBACK_BANNER_MEDIA_ID,
        caption: message,
        type: 'image',
    });
};
