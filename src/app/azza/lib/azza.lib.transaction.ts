import { TransferAssetTransactionDetails, TransferProcessingMode } from '@/app/azza/azza.schema';
import { AssetTransaction } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import UserService from '@/app/User/UserService';
import WalletAssetManagementService from '@/app/WalletAssetManagement/WalletAssetManagementService';
import { TransactionResponse } from '@/app/WalletKit/walletKitSchema';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import { compareHashedString } from '@/resources/utils/hashing';
import { cleanPhoneNumberInput } from '@/resources/utils/phone-numbers';
import { validateWalletAddress } from '@/resources/utils/validators';
import { AssetConfig } from '@/resources/web3/tokens';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';

export type SendTransferTransactionError = {
    message: string;
    data?: unknown;
};
export type SendTransferTransactionResponse = {
    transactionId: string;
    userId: string;
    destination: string;
    transactionAmount: number;
    transactionFee: number;
    totalAmount: number;
    asset: AssetConfig;
    walletManager: 'new' | 'legacy';
};
export type SendTransferTransactionResult =
    | [SendTransferTransactionResponse, null]
    | [null, SendTransferTransactionError];

export const sendTransferAssetTransaction = async (
    params: TransferAssetTransactionDetails,
    requireTransactionPin = true,
    walletManager: 'new' | 'legacy' = 'new'
): Promise<SendTransferTransactionResult> => {
    const { recipient, recipientType, assetId, transactionFee, amount, userId, transactionPin } =
        params;

    if (!userId) {
        throw new Error('User ID is required');
    }
    if (!transactionPin && requireTransactionPin) {
        throw new Error('Transaction pin is required');
    }

    const assetConfig = getAssetConfigOrThrow(assetId);
    const user =
        walletManager === 'legacy'
            ? await UserService.getUserByPhoneNumber(userId)
            : await userServiceV2.getUserById(userId);

    if (!user?.transactionPinHash) {
        throw new Error('Transaction pin not set');
    }

    if (transactionPin && !(await compareHashedString(transactionPin, user.transactionPinHash))) {
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
        const existingAzzaUser =
            await userServiceV2.searchWhatsappUserByPhoneNumber(cleanPhoneInput);

        if (existingAzzaUser) {
            transferProcessingConfig.resolvedRecipient = (
                await azzaWalletManager.getUserWallet(existingAzzaUser.id, assetConfig.network)
            ).address;
        } else {
            transferProcessingConfig.processingMode = 'claimable';
        }
    }

    if (transferProcessingConfig.processingMode === 'claimable') {
        const errorMessage = `You can only transfer to Phone Numbers on Azza at the moment.`;

        return [
            null,
            {
                message: errorMessage,
            },
        ];
    }

    if (!validateWalletAddress(transferProcessingConfig.resolvedRecipient, assetConfig.network)) {
        const errorMessage = `${transferProcessingConfig.resolvedRecipient} is not a valid wallet address for ${assetConfig.network}`;

        return [
            null,
            {
                message: errorMessage,
            },
        ];
    }

    const totalAmount = amount + transactionFee;

    let transactionResponse: {
        transactionId: string;
        status: TransactionResponse['status'] | AssetTransaction['status'];
    };

    if (walletManager === 'legacy') {
        const userWalletInfo = await UserService.getUserAssetInfo(userId, assetId);
        transactionResponse = await WalletAssetManagementService.transferUserAssetToWallet(
            userWalletInfo,
            transferProcessingConfig.resolvedRecipient,
            totalAmount.toString()
        );
    } else {
        const assetTransaction = await azzaWalletManager.withdrawAsset({
            amount: totalAmount.toString(),
            recipient: transferProcessingConfig.resolvedRecipient,
            assetId: assetId,
            userId: userId,
        });

        transactionResponse = {
            transactionId: assetTransaction.id,
            status: assetTransaction.status,
        };
    }

    if (transactionResponse.status === 'failed' || transactionResponse.status === 'FAILED') {
        return [
            null,
            {
                message: 'Submitting transaction failed',
            },
        ];
    }

    return [
        {
            transactionId: transactionResponse.transactionId,
            userId,
            destination: transferProcessingConfig.resolvedRecipient,
            transactionAmount: amount,
            asset: assetConfig,
            transactionFee,
            totalAmount,
            walletManager,
        },
        null,
    ];
};
