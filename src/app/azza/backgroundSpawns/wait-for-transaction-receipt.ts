import { SendTransferTransactionResponse } from '@/app/azza/lib/azza.lib.transaction';
import { waitForTransactionReceipt } from '@/app/azza/lib/azza.lib.wait-for-transaction-receipt';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { PhoneNumberParams } from '@/app/WhatsAppBot/WhatsAppBotType';
import { HttpException } from '@/resources/exceptions/HttpException';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';

export type WaitForTransactionReceiptParams = {
    transaction: SendTransferTransactionResponse;
    phoneParams: PhoneNumberParams;
};
const transactionParams: WaitForTransactionReceiptParams = JSON.parse(process.argv[2]);

async function processInBackground(params: WaitForTransactionReceiptParams) {
    const { transactionId, transactionAmount, destination, asset } = params.transaction;
    const { businessPhoneNumberId, userPhoneNumber } = params.phoneParams;

    const assetLabel = `${asset.tokenName} (${asset.network})`;

    try {
        const receipt = await waitForTransactionReceipt(params.transaction);
        const transactionHash = receipt.transactionHash;
        const transactionStatus = receipt.status;
        const explorerUrl = receipt.explorerUrl;

        if (transactionStatus === 'success' && transactionHash) {
            const message = MessageGenerators.generateInteractiveCtaUrlButtonMessage({
                bodyText: `✅ Your Transaction with the following details has been completed:\n\n🔀 Transfer ${transactionAmount} ${assetLabel} to ${destination}${transactionId !== transactionHash ? `\n\n➡️ Request ID: ${transactionId}` : ''}\n\n➡️ Transaction Hash: ${transactionHash}`,
                ctaText: 'View In Explorer',
                ctaUrl: explorerUrl!,
                recipient: userPhoneNumber,
                headerText: 'Transaction Completed',
                footerText: 'Thank you for using Azza!',
            });

            await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, message);
        }

        if (transactionStatus === 'failed') {
            const message = MessageGenerators.generateTextMessage(
                userPhoneNumber,
                `❌ Your Transaction with the following details has failed:\n\n🔀 Transfer ${transactionAmount} ${assetLabel} to ${destination}\n\n➡️ Request ID: ${transactionId}\n\nPlease try again later or contact support for assistance.`
            );

            await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, message);

            await logServiceError(
                new HttpException(500, 'Transaction failed', {
                    receipt,
                    params,
                }),
                'Transaction failed:'
            );
        }
    } catch (error) {
        await logServiceError(error, 'Waiting for transaction receipt in background failed:');
    }
}

void processInBackground(transactionParams);
