import WalletKitService from '@/app/WalletKit/WalletKitService';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { HttpException } from '@/resources/exceptions/HttpException';
import { SupportedChain, TransactionResponse } from '@/app/WalletKit/walletKitSchema';
import {
    ExtendedWalletSupportedNetworks,
    ExtendedWalletTransaction,
} from '@/app/ExtendedWallet/extendedWalletSchema';
import { isExtendedNetwork } from '@/app/ExtendedWallet/utils';
import UserService from '@/app/User/UserService';
import { delay } from '@/resources/utils/delay';

export type WaitForTransactionReceiptInBackgroundParams = {
    transactionId: string;
    userId: string;
    destination: string;
    amount: string;
    assetLabel: string;
    network: SupportedChain | ExtendedWalletSupportedNetworks;
};

type TransactionDetails = TransactionResponse | ExtendedWalletTransaction;

const transactionParams: WaitForTransactionReceiptInBackgroundParams = JSON.parse(process.argv[2]);

async function processInBackground(params: WaitForTransactionReceiptInBackgroundParams) {
    const { transactionId, userId, amount, destination, assetLabel } = params;

    try {
        let transactionDetails: TransactionDetails;

        if (isExtendedNetwork(params.network)) {
            const extendedWallet = await UserService.getExtendedWallet(userId, params.network);
            transactionDetails = await extendedWallet.getTransaction(transactionId);
        } else {
            transactionDetails = await WalletKitService.getTransactionById(transactionId);
        }

        if (transactionDetails.status === 'submitted' || transactionDetails.status === 'pending') {
            await delay(3000);

            return processInBackground(params);
        }

        const transactionHash =
            'transaction_hash' in transactionDetails
                ? transactionDetails.transaction_hash
                : transactionDetails.transactionHash;
        const explorerUrl =
            'explorer_url' in transactionDetails
                ? transactionDetails.explorer_url
                : transactionDetails.explorerUrl;

        if (transactionDetails.status === 'success' && transactionHash) {
            const message = MessageGenerators.generateInteractiveCtaUrlButtonMessage({
                bodyText: `✅ Your Transaction with the following details has been completed:\n\n🔀 Transfer ${amount} ${assetLabel} to ${destination}${transactionId !== transactionHash ? `\n\n➡️ Request ID: ${transactionId}` : ''}\n\n➡️ Transaction Hash: ${transactionHash}`,
                ctaText: 'View In Explorer',
                ctaUrl: explorerUrl!,
                recipient: userId,
                headerText: 'Transaction Completed',
                footerText: 'Thank you for using Azza!',
            });

            await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
        }

        if (transactionDetails.status === 'failed') {
            const message = MessageGenerators.generateTextMessage(
                userId,
                `❌ Your Transaction with the following details has failed:\n\n🔀 Transfer ${amount} ${assetLabel} to ${destination}\n\n➡️ Request ID: ${transactionId}\n\nPlease try again later or contact support for assistance.`
            );

            await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

            await logServiceError(
                new HttpException(500, 'Transaction failed', {
                    transactionDetails,
                    params,
                }),
                'Transaction failed:'
            );
        }
    } catch (error) {
        await logServiceError(error, 'Waiting for transaction receipt in background failed:');
    }
}

processInBackground(transactionParams).then(() =>
    console.log('Transaction receipt processed in background')
);
