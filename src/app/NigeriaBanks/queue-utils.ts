import { queues } from '@/background-processing/queues';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { QueueNames, NGNBankTransactionQueueInput } from '@/background-processing/types';
import { Worker } from 'bullmq';
import SafeHavenService from './SafeHaven/SafeHavenService';
import { transactionStatusSchema } from '../FiatRamp/fiatRampSchema';
import { prettifyNumber } from '@/resources/utils/currency';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { addCashbackJobToQueue } from '../campaigns/base-cashbacks/utils';
import { generateOfframpToBankRecipientReceipt } from '../receipts/generators';
import WhatsAppBotService from '../WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { addCryptoPayoutJobToQueue } from '../crypto-payouts-v2/utils';
import NigeriaBanksService from './NigeriaBanksService';
import { HttpException } from '@/resources/exceptions/HttpException';
import { NOT_FOUND } from '@/constants/status-codes';
import BellService from './BellMFB/BellService';

export const addSafeHavenTransactionUpdateJobToQueue = async (
    input: NGNBankTransactionQueueInput
) => {
    const jobId = `${input.processorName}-transaction-${input.transactionId}`;
    return queues.handleNGNBankTransactionStatusUpdate.add(jobId, input, {
        jobId,
        removeOnComplete: false,
    });
};

export const createSafeHavenTransactionUpdateJobWorker = () => {
    return new Worker<NGNBankTransactionQueueInput>(
        QueueNames.handleNGNBankTransactionStatusUpdate,
        async (job) => {
            const { transactionId } = job.data;

            const settlement =
                await NigeriaBanksService.getNGNBankOfframpProcessingTransaction(transactionId);

            const transaction = settlement.processorName === 'safehaven'
                ? await SafeHavenService.getSafeHavenTransactionBySessionId(settlement.sessionId as string)
                : settlement.processorName === 'bell'
                    ? await BellService.getBellTransactionByReferenceId(settlement.sessionId as string)
                    : (() => { throw new HttpException(NOT_FOUND, 'processor name not found'); })();

            const totalAmount = prettifyNumber(
                (settlement.usdAmount ?? 0) + (settlement.transactionFeeUsd ?? 0)
            );

            const userPhoneNumber = await userServiceV2.getUserPhoneNumber(
                settlement.ownerId as string
            );

            const transactionDetailsString = `💲Sell ${totalAmount} ${settlement.tokenSymbol} on ${settlement.blockchainNetwork} for ${settlement.localCurrencySymbol} ${prettifyNumber(settlement!.localAmount!)}`;

            if (transaction.status.toLowerCase() === 'completed' || transaction.status.toLowerCase() === 'successful') {
                await settlement.update({
                    processingStatus: transactionStatusSchema.parse('complete'),
                });

                const completeMessage =
                    NigeriaBanksService.TransactionCompleteMessage(transactionDetailsString);

                await NigeriaBanksService.sendArbitraryTextMessage(completeMessage, userPhoneNumber);

                const supportedChain = settlement.blockchainNetwork
                    ? azzaWalletManager
                        .getSupportedNetworks()
                        .find(
                            (chain) =>
                                chain.toLowerCase() ===
                                settlement.blockchainNetwork!.toLowerCase()
                        )
                    : undefined;

                if (supportedChain === 'Base') {
                    await addCashbackJobToQueue({
                        transactionId: settlement.sequenceId!,
                        transactionType: 'ngn-bank-offramp',
                    });
                }

                const receiptBuffer = await generateOfframpToBankRecipientReceipt({
                    status: 'complete',
                    blockchainNetwork: settlement.blockchainNetwork!,
                    usdAmount: settlement.usdAmount!,
                    localAmount: settlement.localAmount!,
                    localCurrencySymbol: settlement.localCurrencySymbol!,
                    tokenSymbol: settlement.tokenSymbol!,
                    ownerId: settlement.ownerId!,
                    transactionHash: settlement.transactionHash!,
                    transactionFeeUsd: settlement.transactionFeeUsd!,
                    destination: {
                        accountName: settlement.destinationAccountName!,
                        accountNumber: settlement.destinationAccountNumber!,
                        networkName: settlement.destinationNetworkName!,
                        networkId: '',
                        country: settlement.country!,
                        accountType: 'bank',
                    },
                    createdAt: settlement.xata.createdAt.toISOString(),
                    rate: settlement.conversionRate!,
                    sequenceId: settlement.sequenceId!,
                    hotWalletAddress: settlement.hotWalletAddress!,
                    platformFeePercentage: settlement.platformFeePercentage!,
                    fromWalletAddress: settlement.fromWalletAddress!,
                    tokenAddress: settlement.tokenAddress!,
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
                            mediaId: uploadedMedia.id,
                            caption: `🧾Transaction Receipt`,
                            type: 'image',
                        }
                    );
                }

                return;
            }

            if (transaction.status.toLowerCase() !== 'completed' ||
                transaction.status.toLowerCase() !== 'successful' ||
                transaction.isReversed) {
                await settlement.update({
                    processingStatus: transactionStatusSchema.parse('failed'),
                });

                const failedMessage =
                    NigeriaBanksService.TransactionFailedMessage(transactionDetailsString);

                await NigeriaBanksService.sendArbitraryTextMessage(failedMessage, userPhoneNumber);

                await addCryptoPayoutJobToQueue({
                    transactionId: settlement.sequenceId!,
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
