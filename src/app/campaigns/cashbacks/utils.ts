import { HUNDRED } from '@/constants/numbers';
import { CashBackChains, ChainPercentCashbackConfig, PercentageCashbackParams, PercentageCashbackQueueInput } from './types';
import * as math from 'mathjs';
import platformWalletManager from '@/runtime/platform-wallets';
import { Worker } from 'bullmq';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { PhoneNumberParams } from '@/app/WhatsAppBot/WhatsAppBotType';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import ManualOfframpSettlementService from '@/app/FiatRamp/alternatives/ManualOfframpSettlementService';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import logger from '@/resources/logger';
import NigeriaBanksService from '@/app/NigeriaBanks/NigeriaBanksService';
import { CASHBACK_QUEUES, getChainCashbackConfig } from './config';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import { z } from 'zod';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import HoneyCoinService from '@/app/HoneyCoin/HoneyCoinService';
import { clipDecimal } from '@/resources/utils/transformers';

export const processCashback = async (params: PercentageCashbackParams) => {
    const convertedPercentage = math.divide(params.cashbackPercentage, HUNDRED);
    const cashbackAmountUsd = clipDecimal(
        math.multiply(params.tradeAmountUsd, convertedPercentage),
        6
    );

    return await platformWalletManager.withdrawAsset({
        assetId: params.assetId,
        userId: params.payoutWalletId,
        amount: cashbackAmountUsd.toString(),
        recipient: params.userWalletAddress,
        reference: params.payoutReference,
        metadata: {
            reason: params.payoutReason,
        },
    });
};

type AddCashbackJobParams = PercentageCashbackQueueInput & {
    blockchain: CashBackChains;
}

export const addCashbackJobToQueue = async (input: AddCashbackJobParams) => {
    const config = getChainCashbackConfig(input.blockchain);
    const featureIsEnabled = await FeatureFlagService.isFeatureEnabled(config.featureFlag);

    if (!featureIsEnabled) {
        return;
    }
    const jobId = `cashback-${input.blockchain.toLowerCase()}-${input.transactionId}`;

    return CASHBACK_QUEUES[input.blockchain].add(jobId, input, {
        jobId,
        removeOnComplete: false,
    });
};

export const createCashbackWorker = (queueName: string, config: ChainPercentCashbackConfig) => {
    return new Worker<PercentageCashbackQueueInput>(
        queueName,
        async (job) => {
            const { transactionId, transactionType } = job.data;

            const transaction = await (async () => {
                if (transactionType === 'manual-offramp') {
                    return await ManualOfframpSettlementService.getManualOfframpSettlementBySequenceId(
                        transactionId
                    );
                }
                if (transactionType === 'ngn-bank-offramp') {
                    return await NigeriaBanksService.getNGNBankOfframpTransactionBySequenceId(
                        transactionId
                    );
                }
                if (transactionType === 'offramp') {
                    return await FiatRampService.getOfframpTransaction(transactionId);
                }
                if (transactionType === 'onramp') {
                    return await FiatRampService.getOnrampTransaction(transactionId);
                }
                if (transactionType === 'honey-coin-offramp') {
                    return await HoneyCoinService.getHoneyCoinOfframpTransaction(transactionId)
                }
                throw new Error(`Invalid transaction type: ${transactionType}`);
            })();

            if (!transaction) {
                throw Error(`Transaction with ID ${transactionId} not found`);
            }

            const transactionUsdAmount = transaction.usdAmount!;

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
            if (!job.id) {
                throw new Error('Expected deterministic job ID');
            }

            const cashbackParams: PercentageCashbackParams = {
                tradeAmountUsd: transactionUsdAmount,
                userWalletAddress: destinationWalletAddress,
                targetTransactionHash: transaction.sequenceId,
                cashbackPercentage: config.percentage,
                assetId: config.assetId,
                payoutReason: config.payoutReason,
                payoutReference: job.id,
                payoutWalletId: config.payoutWalletId
            };

            try {
                return await processCashback(cashbackParams);
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
    phoneParams: PhoneNumberParams,
    media: {
        id?: string;
        link?: string;
    }
) => {
    return await WhatsAppBotService.sendMediaMessage(phoneParams, {
        media: media,
        caption: message,
        type: 'image',
    });
};

export const isCashBackEnabledChain = (chain: AllSupportedBlockchains): chain is CashBackChains => {
    return z.enum(['Base', 'Solana']).safeParse(chain).success
}