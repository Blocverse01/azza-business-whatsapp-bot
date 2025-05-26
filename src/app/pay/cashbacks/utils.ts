import { HUNDRED } from '@/constants/numbers';
import { PercentageCashbackParams, PercentageCashbackQueueInput } from './types';
import * as math from 'mathjs';
import platformWalletManager from '@/runtime/platform-wallets';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import crypto from 'node:crypto';
import {
    PIZZA_DAY_CASHBACK_REASON,
    PIZZA_DAY_CASHBACK_REFERENCE_PREFIX,
} from '@/constants/strings';
import { queues } from '@/background-processing/queues';
import { QueueNames } from '@/background-processing/types';
import { Worker } from 'bullmq';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import azzaWalletManager from '@/runtime/wallet';
import { PhoneNumberParams, WhatsAppMediaMessage } from '@/app/WhatsAppBot/WhatsAppBotType';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import ManualOfframpSettlementService from '@/app/FiatRamp/alternatives/ManualOfframpSettlementService';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import logger from '@/resources/logger';
import SafeHavenService from '@/app/SafeHaven/SafeHavenService';

const CASHBACK_PAYOUT_WALLET_USER_ID = 'cashback-payout';
const PIZZA_DAYA_CASHBACK_BANNER_MEDIA_LINK =
    'https://res.cloudinary.com/dltnruk3l/image/upload/v1747914169/Coupon_Code_3_tju80z.png';

const generateTransactionReferenceId = (targetTransactionHash: string) => {
    const txHashSha256 = crypto.createHash('sha256').update(targetTransactionHash).digest('hex');
    const relevantParts = txHashSha256.slice(0, 16) + txHashSha256.slice(-8);
    return `${PIZZA_DAY_CASHBACK_REFERENCE_PREFIX}${relevantParts}`;
};

export const processPizzaDayCashback = async (params: PercentageCashbackParams) => {
    const convertedPercentage = math.divide(params.cashbackPercentage, HUNDRED);
    const cashbackAmountUsd = math.fix(
        math.multiply(params.tradeAmountUsd, convertedPercentage),
        6
    );
    const asset = getAssetConfigOrThrow('usdt-celo');

    return await platformWalletManager.withdrawAsset({
        assetId: asset.listItemId,
        userId: CASHBACK_PAYOUT_WALLET_USER_ID,
        amount: cashbackAmountUsd.toString(),
        recipient: params.userWalletAddress,
        reference: generateTransactionReferenceId(params.targetTransactionHash),
        metadata: {
            reason: PIZZA_DAY_CASHBACK_REASON,
        },
    });
};

export const addPizzaDayCashbackJobToQueue = async (input: PercentageCashbackQueueInput) => {
    const featureIsEnabled = await FeatureFlagService.isFeatureEnabled(
        FeatureFlagKey.PIZZA_DAY_CAMPAIGN
    );
    if (!featureIsEnabled) {
        return;
    }
    const jobId = `pizza-day-cashback-${input.transactionId}`;
    return queues.pizzaDayCashback.add(jobId, input, {
        jobId,
        removeOnComplete: false,
    });
};

export const createPizzaDayCashbackWorker = () => {
    return new Worker<PercentageCashbackQueueInput>(
        QueueNames.pizzaDayCashback,
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
                'fromWalletAddress' in transaction ? transaction.fromWalletAddress : '';

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
                cashbackPercentage: 5,
                assetId: assetConfig.listItemId,
            };

            try {
                return await processPizzaDayCashback(cashbackParams);
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

export const sendPizzaDayDepositMessageWithCashbackBanner = async (
    message: string,
    phoneParams: PhoneNumberParams
) => {
    return await WhatsAppBotService.sendWhatsappMessage(phoneParams.businessPhoneNumberId, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneParams.userPhoneNumber,
        type: 'image',
        image: {
            link: PIZZA_DAYA_CASHBACK_BANNER_MEDIA_LINK,
            caption: message,
        },
    } satisfies WhatsAppMediaMessage);
};
