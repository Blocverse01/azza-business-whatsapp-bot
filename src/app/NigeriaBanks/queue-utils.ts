import { queues } from '@/background-processing/queues';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { QueueNames, NGNBankTransactionQueueInput } from '@/background-processing/types';
import { Worker } from 'bullmq';
import SafeHavenService from './SafeHaven/SafeHavenService';
import { transactionStatusSchema } from '../FiatRamp/fiatRampSchema';
import { prettifyNumber } from '@/resources/utils/currency';
import userServiceV2 from '@/runtime/user';
import { addCashbackJobToQueue, isCashBackEnabledChain } from '../campaigns/cashbacks/utils';
import { generateOfframpReceipt } from '../receipts/generators';
import WhatsAppBotService from '../WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { addCryptoPayoutJobToQueue } from '../crypto-payouts-v2/utils';
import NigeriaBanksService from './NigeriaBanksService';
import { HttpException } from '@/resources/exceptions/HttpException';
import { NOT_FOUND } from '@/constants/status-codes';
import BellService from './BellMFB/BellService';
import {
    BELL_OFFRAMP_PAYMENT_PROCESSOR_ID,
    SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID,
} from '../FiatRamp/config';
import { dbClient } from '@/db/dbClient';
import { isPeggedCurrency } from '../FiatRamp/token-currency-pair-rate/utils';
import { normalizeTxHash, searchSupportedBlockchain } from '../FiatRamp/utils';

export const addNgnBankTransactionUpdateJobToQueue = async (
    input: NGNBankTransactionQueueInput
) => {
    const jobId = `${input.processorName}-transaction-${input.transactionId}`;
    return queues.handleNGNBankTransactionStatusUpdate.add(jobId, input, {
        jobId,
        removeOnComplete: false,
    });
};

export const createNgnBankTransactionUpdateJobWorker = () => {
    return new Worker<NGNBankTransactionQueueInput>(
        QueueNames.handleNGNBankTransactionStatusUpdate,
        async (job) => {
            const { transactionId } = job.data;

            const settlement =
                await NigeriaBanksService.getNGNBankOfframpProcessingTransaction(transactionId);

            const transaction = await (async () => {
                if (settlement.processorName === SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID) {
                    return await SafeHavenService.getSafeHavenTransactionBySessionId(
                        settlement.sessionId as string
                    );
                } else if (settlement.processorName === BELL_OFFRAMP_PAYMENT_PROCESSOR_ID) {
                    return await BellService.getBellTransactionByReferenceId(settlement.sequenceId);
                } else {
                    throw new HttpException(NOT_FOUND, 'processor name not found');
                }
            })();

            const offrampRequest = await dbClient.offramp_awaiting_crypto_debit
                .filter({
                    cryptoTransactionId: normalizeTxHash(settlement.transactionHash),
                })
                .getFirst();

            if (!offrampRequest) {
                throw new Error('Offramp request not found');
            }
            const totalAmount = offrampRequest.tokenAmountToDebit;
            // const cryptoToFiatConversionRate =
            //     (settlement.localAmount +
            //         Math.max(settlement.localAmount * settlement.platformFeePercentage)) /
            //     totalAmount;

            const userPhoneNumber = await userServiceV2.getUserPhoneNumber(settlement.ownerId);

            const transactionDetailsString = `💲Sell ${totalAmount} ${settlement.tokenSymbol} on ${settlement.blockchainNetwork} for ${settlement.localCurrencySymbol} ${prettifyNumber(settlement!.localAmount!)}`;

            if (
                transaction.status.toLowerCase() === 'completed' ||
                transaction.status.toLowerCase() === 'successful'
            ) {
                await settlement.update({
                    processingStatus: transactionStatusSchema.parse('complete'),
                });

                const completeMessage =
                    NigeriaBanksService.TransactionCompleteMessage(transactionDetailsString);

                await NigeriaBanksService.sendArbitraryTextMessage(
                    completeMessage,
                    userPhoneNumber
                );

                const supportedChain = searchSupportedBlockchain(settlement.blockchainNetwork!);
                if (supportedChain && isCashBackEnabledChain(supportedChain)) {
                    await addCashbackJobToQueue({
                        transactionId: settlement.sequenceId!,
                        transactionType: 'ngn-bank-offramp',
                        blockchain: supportedChain,
                    });
                }

                const receiptBuffer = await generateOfframpReceipt({
                    status: 'complete',
                    blockchainNetwork: settlement.blockchainNetwork,
                    usdAmount: totalAmount,
                    localAmount: settlement.localAmount,
                    localCurrencySymbol: settlement.localCurrencySymbol!,
                    tokenSymbol: settlement.tokenSymbol,
                    ownerId: settlement.ownerId,
                    transactionHash: settlement.transactionHash,
                    transactionFeeUsd: isPeggedCurrency(
                        settlement.tokenSymbol,
                        settlement.localCurrencySymbol!
                    )
                        ? 0
                        : settlement.transactionFeeUsd,
                    destination: {
                        accountName: settlement.destinationAccountName,
                        accountNumber: settlement.destinationAccountNumber,
                        networkName: settlement.destinationNetworkName,
                        networkId: '',
                        country: settlement.country,
                        accountType: 'bank',
                    },
                    createdAt: settlement.xata.createdAt.toISOString(),
                    rate: settlement.conversionRate,
                    sequenceId: settlement.sequenceId,
                    hotWalletAddress: settlement.hotWalletAddress,
                    platformFeePercentage: settlement.platformFeePercentage,
                    fromWalletAddress: settlement.fromWalletAddress,
                    tokenAddress: settlement.tokenAddress,
                    processorName: settlement.processorName!,
                });

                const uploadedMedia = await WhatsAppBotService.uploadImageToWhatsapp(
                    env.WA_PHONE_NUMBER_ID,
                    new File([Buffer.from(receiptBuffer)], `receipt-${settlement.sequenceId}.png`, {
                        type: 'image/png',
                    })
                );

                if (uploadedMedia) {
                    await WhatsAppBotService.sendMediaMessage(
                        {
                            userPhoneNumber,
                            businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        },
                        {
                            media: uploadedMedia,
                            caption: `🧾Transaction Receipt`,
                            type: 'image',
                        }
                    );
                }

                return;
            }

            if (
                transaction.status.toLowerCase() !== 'completed' ||
                transaction.status.toLowerCase() !== 'successful' ||
                transaction.isReversed
            ) {
                await settlement.update({
                    processingStatus: transactionStatusSchema.parse('failed'),
                });

                const failedMessage =
                    NigeriaBanksService.TransactionFailedMessage(transactionDetailsString);

                await NigeriaBanksService.sendArbitraryTextMessage(failedMessage, userPhoneNumber);

                await addCryptoPayoutJobToQueue({
                    transactionId: settlement.sequenceId,
                    transactionType: 'offramp-ngn-bank-refund',
                });
            }
        },
        {
            connection: connectionConfig,
            concurrency: 20,
        }
    );
};
