import { TransferAssetTransactionDetails, TransferProcessingMode } from '@/app/azza/azza.schema';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import UserService from '@/app/User/UserService';
import { compareHashedString } from '@/resources/utils/hashing';
import { cleanPhoneNumberInput } from '@/resources/utils/phone-numbers';
import { validateWalletAddress } from '@/resources/utils/validators';
import WalletAssetManagementService from '@/app/WalletAssetManagement/WalletAssetManagementService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { spawnInBackground } from '@/app/azza/backgroundSpawns/spawn-in-background';
import { WaitForTransactionReceiptInBackgroundParams } from '@/app/azza/backgroundSpawns/wait-for-transaction-receipt';
import { WAIT_FOR_TRANSACTION_RECEIPT_SCRIPT_PATH } from '@/app/azza/backgroundSpawns/script-paths';

export const sendTransferAssetTransaction = async (params: TransferAssetTransactionDetails) => {
    const { recipient, recipientType, assetId, transactionFee, amount, userId, transactionPin } =
        params;

    if (!userId) {
        throw new Error('User ID is required');
    }
    if (!transactionPin) {
        throw new Error('Transaction pin is required');
    }

    const assetConfig = getAssetConfigOrThrow(assetId);
    const [userWalletInfo, user] = await Promise.all([
        UserService.getUserAssetInfo(userId, assetId),
        UserService.getUserByPhoneNumber(userId),
    ]);

    if (!user?.transactionPinHash) {
        throw new Error('Transaction pin not set');
    }

    if (!(await compareHashedString(transactionPin, user.transactionPinHash))) {
        throw new Error('Invalid transaction pin');
    }

    const transferProcessingConfig: {
        processingMode: TransferProcessingMode;
        resolvedRecipient: string;
    } = {
        processingMode: 'direct',
        resolvedRecipient: recipient,
    };

    if (recipientType === 'PHONE_NUMBER') {
        const cleanPhoneInput = cleanPhoneNumberInput(recipient);
        const existingAzzaUser = await UserService.searchUserByPhoneNumber(cleanPhoneInput);

        if (existingAzzaUser?.phoneNumber) {
            transferProcessingConfig.resolvedRecipient = (
                await UserService.getUserAssetWalletOrThrow(existingAzzaUser.phoneNumber, assetId)
            ).walletAddress;
        } else {
            transferProcessingConfig.processingMode = 'claimable';
        }
    }

    if (transferProcessingConfig.processingMode === 'direct') {
        if (
            !validateWalletAddress(transferProcessingConfig.resolvedRecipient, assetConfig.network)
        ) {
            const responseMessage = MessageGenerators.generateTextMessage(
                userId,
                `${transferProcessingConfig.resolvedRecipient} is not a valid wallet address for ${assetConfig.network}`
            );

            await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, responseMessage);

            return;
        }

        const totalAmount = amount + transactionFee;

        const transactionResponse = await WalletAssetManagementService.transferUserAssetToWallet(
            userWalletInfo,
            transferProcessingConfig.resolvedRecipient,
            totalAmount.toString()
        );
        let responseMessage = '';
        if (transactionResponse.status === 'failed') {
            responseMessage = 'Submitting transaction failed';
        } else {
            responseMessage = `⏳ Your transaction with the following details is being processed:\n\n🔀 Transfer ${amount} ${assetConfig.tokenName} on ${assetConfig.network} to ${transferProcessingConfig.resolvedRecipient}\n\n🆔 Request ID: ${transactionResponse.transactionId}`;
        }

        const message = MessageGenerators.generateTextMessage(userId, responseMessage);
        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

        spawnInBackground<WaitForTransactionReceiptInBackgroundParams>(
            {
                transactionId: transactionResponse.transactionId,
                userId,
                destination: transferProcessingConfig.resolvedRecipient,
                amount: totalAmount.toString(),
                assetLabel: `${assetConfig.tokenName} on ${assetConfig.network}`,
                network: assetConfig.network,
            },
            WAIT_FOR_TRANSACTION_RECEIPT_SCRIPT_PATH
        );

        return;
    }

    if (transferProcessingConfig.processingMode === 'claimable') {
    }
};
