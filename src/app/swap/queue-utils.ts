import { swapTokensTransactionDetailsV2Schema } from '@/app/azza/azza.schema';
import { getMasterWalletClient } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import SwapService from '@/app/swap/service';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { defaultQueueRemoveOptions, queues } from '@/background-processing/queues';
import {
    BlockradarAddressSwapQueueInput,
    BlockradarMasterWalletSwapsQueueInput,
    QueueNames,
} from '@/background-processing/types';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import { decimalToString, fixNumber } from '@/resources/utils/currency';
import { convertBase64ToAsciiString } from '@/resources/utils/encryption';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { ConnectionOptions, Worker } from 'bullmq';
import * as assert from 'node:assert';

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

    const amountToSwap = swapDetails.fromAmount - swapDetails.transactionFee;
    const amountToDebit = swapDetails.fromAmount;

    const swapTxReference = await SwapService.createOrRecoverSwapTransaction(
        jobId,
        swapTokensTransactionDetailsV2Schema.parse({
            ...swapDetails,
            fromAmount: amountToSwap,
            userId: convertBase64ToAsciiString(swapDetails.userId),
        })
    );
    const fromTokenConfig = getAssetConfigOrThrow(swapDetails.fromTokenId);
    const masterWalletClient = getMasterWalletClient(fromTokenConfig.network);

    const masterWalletAddress = masterWalletClient.walletAddress;

    const withdrawalTx = await azzaWalletManager.withdrawAsset({
        amount: decimalToString(fixNumber(amountToDebit, 6)),
        assetId: swapDetails.fromTokenId,
        userId: convertBase64ToAsciiString(swapDetails.userId),
        reference: swapTxReference,
        recipient: masterWalletAddress,
        metadata: {
            reason: SwapService.SWAP_WITHDRAWAL_TX_REASON,
        },
    });

    if (withdrawalTx.status === 'FAILED') {
        await WhatsAppBotService.sendWhatsappMessage(
            whatsappParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                `❌ Your swap transaction failed, please try again.\n\nIf you were debited, please contact reach out for assistance using the /support command.`
            )
        );
        return withdrawalTx;
    }

    await WhatsAppBotService.sendWhatsappMessage(
        whatsappParams.businessPhoneNumberId,
        MessageGenerators.generateTextMessage(
            whatsappParams.userPhoneNumber,
            `📬 Your swap transaction has been initiated successfully, please wait...`
        )
    );

    return withdrawalTx;
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

// Temporary augmentation for Address Swaps
//////////////////////////
// Master wallet
//////////////////////////
export const addBlockradarMasterWalletTokenSwapJobToQueue = async (
    jobId: string,
    data: BlockradarMasterWalletSwapsQueueInput
) => {
    return await queues.blockradarMasterWalletSwaps.add(`Swap execution: ${jobId}`, data, {
        jobId,
        removeOnComplete: defaultQueueRemoveOptions.removeOnComplete,
        removeOnFail: false,
    });
};

const handleBlockradarMasterWalletTokenSwapJob = async (
    jobId: string,
    data: BlockradarMasterWalletSwapsQueueInput
) => {
    const { swapDebitReferenceId, swapDebitTransactionHash, whatsappParams } = data;
    const swapTransactionRecord =
        await SwapService.getSwapTransactionByExternalReference(swapDebitReferenceId);

    if (!swapTransactionRecord) {
        throw new Error('Error: swapTransactionRecord does not exist');
    }

    const fromAssetConfig = azzaWalletManager.searchAssets({
        network: swapTransactionRecord.fromBlockchain,
        tokenName: swapTransactionRecord.fromTokenSymbol,
    })[0];
    const toAssetConfig = azzaWalletManager.searchAssets({
        network: swapTransactionRecord.toBlockchain,
        tokenName: swapTransactionRecord.toTokenSymbol,
    })[0];

    const masterWalletClient = getMasterWalletClient(fromAssetConfig.network);
    const onChainDebitTransaction = await azzaWalletManager.getTransactionByHash(
        swapDebitTransactionHash,
        fromAssetConfig.network
    );

    if (onChainDebitTransaction.status !== 'SUCCESS') {
        throw new Error('OnChainDebitTransaction failed.');
    }

    assert.ok(
        Number(onChainDebitTransaction.amount) > swapTransactionRecord.fromAmount,
        'Transaction amount is less than expected `fromAmount`'
    );
    assert.ok(
        onChainDebitTransaction.recipientAddress.toLowerCase() ===
            masterWalletClient.walletAddress.toLowerCase(),
        'Transaction recipient must be master wallet'
    );
    assert.ok(
        onChainDebitTransaction.reference?.startsWith(SwapService.EXTERNAL_REFERENCE_PREFIX),
        'Invalid on-chain debit transaction for swap'
    );

    const userPhoneNumber = await userServiceV2.getUserPhoneNumber(swapTransactionRecord.user?.id!);

    const swapTransactionExecution = await azzaWalletManager.executeAssetSwap({
        fromAmount: decimalToString(swapTransactionRecord.fromAmount),
        fromAssetId: fromAssetConfig.listItemId,
        toAssetId: toAssetConfig.listItemId,
        reference: swapDebitReferenceId,
        recipientAddress: swapTransactionRecord.recipientAddress,
    });

    if (swapTransactionExecution.status === 'FAILED') {
        await WhatsAppBotService.sendWhatsappMessage(
            whatsappParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                userPhoneNumber,
                `❌ Your swap transaction failed, please try again.\n\nIf you were debited, please contact reach out for assistance using the /support command.`
            )
        );
        return swapTransactionExecution;
    }

    try {
        await swapTransactionRecord.update({
            status: 'processing',
            transactionHash: `debit_${swapDebitTransactionHash}`,
        });
    } catch (e) {}

    await WhatsAppBotService.sendWhatsappMessage(
        whatsappParams.businessPhoneNumberId,
        MessageGenerators.generateTextMessage(
            userPhoneNumber,
            `🚀 Your swap transaction is being processed`
        )
    );

    return swapTransactionExecution;
};

export const createBlockradarMasterWalletTokenSwapWorker = (connection: ConnectionOptions) => {
    return new Worker<BlockradarMasterWalletSwapsQueueInput>(
        QueueNames.blockradarMasterWalletSwaps,
        async (job) => {
            if (!job.id) {
                throw new Error('Job ID is expected');
            }

            return await handleBlockradarMasterWalletTokenSwapJob(job.id, job.data);
        },
        {
            connection: connection,
        }
    );
};
