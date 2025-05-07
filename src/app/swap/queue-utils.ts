import { swapTokensTransactionDetailsV2Schema } from '@/app/azza/azza.schema';
import SwapService from '@/app/swap/service';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { defaultQueueRemoveOptions, queues } from '@/background-processing/queues';
import { BlockradarAddressSwapQueueInput, QueueNames } from '@/background-processing/types';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import { decimalToString } from '@/resources/utils/currency';
import { convertBase64ToAsciiString } from '@/resources/utils/encryption';
import azzaWalletManager from '@/runtime/wallet';
import { ConnectionOptions, Worker } from 'bullmq';

////////////////////////
// Address-level Swaps
////////////////////////
export const addBlockradarAddressTokenSwapJobToQueue = async (
    jobId: string,
    data: BlockradarAddressSwapQueueInput
) => {
    return await queues.blockradarAddressSwaps.add(`Swap request: ${jobId}`, data, {
        jobId,
        removeOnComplete: defaultQueueRemoveOptions.removeOnComplete,
        removeOnFail: false,
    });
};
const handleBlockradarAddressTokenSwapJob = async (
    jobId: string,
    data: BlockradarAddressSwapQueueInput
) => {
    const { swapDetails, whatsappParams } = data;

    const normalizedUserId = convertBase64ToAsciiString(swapDetails.userId);
    const amountToSwap = swapDetails.fromAmount - swapDetails.transactionFee;

    const swapTransactionRecord = await SwapService.createOrRecoverSwapTransaction(
        jobId,
        swapTokensTransactionDetailsV2Schema.parse({
            ...swapDetails,
            fromAmount: amountToSwap,
            userId: normalizedUserId,
        })
    );
    const swapTxReference = `${SwapService.EXTERNAL_REFERENCE_PREFIX}${swapTransactionRecord.id}`;

    const fromTokenConfig = getAssetConfigOrThrow(swapDetails.fromTokenId);
    const toTokenConfig = getAssetConfigOrThrow(swapDetails.toTokenId);
    const swapTransactionExecution = await azzaWalletManager.executeAssetSwap({
        fromAmount: decimalToString(amountToSwap),
        fromAssetId: fromTokenConfig.listItemId,
        toAssetId: toTokenConfig.listItemId,
        reference: swapTxReference,
        recipientAddress: swapDetails.recipientAddress,
        userId: normalizedUserId,
    });

    if (swapTransactionExecution.status === 'FAILED') {
        await swapTransactionRecord.update({
            status: 'failed',
            transactionHash: swapTransactionExecution.hash,
        });

        await WhatsAppBotService.sendWhatsappMessage(
            whatsappParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                `❌ Your swap transaction failed, please try again.\n\nIf you were debited, please contact reach out for assistance using the /support command.`
            )
        );
        return swapDetails;
    }

    await WhatsAppBotService.sendWhatsappMessage(
        whatsappParams.businessPhoneNumberId,
        MessageGenerators.generateTextMessage(
            whatsappParams.userPhoneNumber,
            `🚀 Your swap transaction is being processed`
        )
    );

    await swapTransactionRecord.update({
        status: 'processing',
        transactionHash: swapTransactionExecution.hash,
    });

    return swapDetails;
};

export const createBlockradarAddressTokenSwapWorker = (connection: ConnectionOptions) => {
    return new Worker<BlockradarAddressSwapQueueInput>(
        QueueNames.blockradarAddressSwaps,
        async (job) => {
            if (!job.id) {
                throw new Error('Job ID is expected');
            }

            return await handleBlockradarAddressTokenSwapJob(job.id, job.data);
        },
        {
            connection: connection,
        }
    );
};
