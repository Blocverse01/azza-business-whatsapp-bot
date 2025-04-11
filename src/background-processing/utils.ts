import { AssetTransferRecipientType } from '@/app/azza/azza.schema';
import { sendTransferAssetTransaction } from '@/app/azza/lib/azza.lib.transaction';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { EventDrivenOfframpWorkerError } from '@/background-processing/errors';
import { queues } from '@/background-processing/queues';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import {
    EventDrivenOfframpQueueInput,
    EventDrivenOfframpQueueResult,
    QueueNames,
    SyncUserWalletIdQueueInput,
} from '@/background-processing/types';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import env from '@/constants/env';
import { OFFRAMP, OFFRAMP_WITHDRAW_REFERENCE_PREFIX } from '@/constants/strings';
import { dbClient } from '@/db/dbClient';
import { convertBase64ToAsciiString, decryptWithAES } from '@/resources/utils/encryption';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import userServiceV2 from '@/runtime/user';
import { Worker } from 'bullmq';

export const createEventDrivenOfframpWorker = () => {
    return new Worker<EventDrivenOfframpQueueInput, EventDrivenOfframpQueueResult>(
        QueueNames.eventDrivenOfframp,
        async (job) => {
            const transactionPin = decryptWithAES(
                job.data.transactionPin,
                env.SECURITY_QUESTIONS_MASK_KEY,
                env.SECURITY_QUESTIONS_MASK_IV
            );
            const offrampParams = job.data.offrampParams;
            const whatsappParams = job.data.whatsappParams;
            const userId = convertBase64ToAsciiString(offrampParams.userId);

            const pendingOfframp = await dbClient.offramp_awaiting_crypto_debit.create({
                ownerId: userId,
                usdAmount: offrampParams.usdAmount,
                localAmount: offrampParams.localAmount,
                assetId: offrampParams.assetId,
                transactionFeeUsd: offrampParams.transactionFeeUsd,
                hotWalletAddress: offrampParams.hotWalletAddress,
                fromWalletAddress: offrampParams.userWalletAddress,
                beneficiaryId: offrampParams.beneficiaryId,
                conversionRate: offrampParams.conversionRate,
                platformFeePercentage: offrampParams.platformFeePercentage,
                tokenAmountToDebit: job.data.offrampParams.tokenAmountToDebit,
            });

            const tokenAmountToDebit = job.data.offrampParams.tokenAmountToDebit;

            const reference = `${OFFRAMP_WITHDRAW_REFERENCE_PREFIX}${pendingOfframp.id}`;

            const [sendCryptoTxResponse, txError] = await sendTransferAssetTransaction(
                {
                    transactionPin,
                    userId,
                    reference,
                    metadata: {
                        reason: OFFRAMP,
                    },
                    amount: tokenAmountToDebit,
                    transactionType: 'SEND',
                    recipient: offrampParams.hotWalletAddress,
                    recipientType: AssetTransferRecipientType.WALLET_ADDRESS,
                    assetId: offrampParams.assetId,
                    transactionFee: 0,
                },
                true,
                'new'
            );

            if (!sendCryptoTxResponse && txError !== null) {
                const assetConfig = getAssetConfigOrThrow(offrampParams.assetId);
                const userMessage = `Debiting ${tokenAmountToDebit} ${assetConfig.tokenName} from your wallet failed.\nPlease reach out to support if you were debited.`;

                await WhatsAppBotService.sendWhatsappMessage(
                    whatsappParams.businessPhoneNumberId,
                    MessageGenerators.generateTextMessage(
                        whatsappParams.userPhoneNumber,
                        userMessage
                    )
                );
                throw new EventDrivenOfframpWorkerError(txError.message, txError.data);
            }

            const message = MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                `🚀 Confirming crypto debit transaction...`
            );
            await WhatsAppBotService.sendWhatsappMessage(
                whatsappParams.businessPhoneNumberId,
                message
            );

            return {
                debitTransactionId: sendCryptoTxResponse.transactionId,
                offrampRequestId: pendingOfframp.id,
            };
        },
        { connection: connectionConfig, concurrency: 100 }
    );
};

export const createSyncUserWalletWorker = () => {
    return new Worker<SyncUserWalletIdQueueInput>(
        QueueNames.syncUserWallet,
        async (job) => {
            const { userId, network, addressId, address } = job.data;
            return await userServiceV2.createUserBlockradarWallet(userId, {
                addressId,
                address,
                blockchainNetwork: network,
            });
        },
        { connection: connectionConfig, concurrency: 3 }
    );
};

export async function syncUserAddressJob(data: {
    userId: string;
    network: AllSupportedBlockchains;
    isEvmCompatible: boolean;
    addressId: string;
    address: string;
}) {
    const networkIdentifier = data.isEvmCompatible ? 'EVM' : `${data.network}`;
    return queues.syncUserWallet.add(`sync-${data.userId}-${networkIdentifier}`, data, {
        jobId: `sync-${data.userId}-${data.network}`, // Ensure job uniqueness
        removeOnComplete: false,
        removeOnFail: false,
    });
}
