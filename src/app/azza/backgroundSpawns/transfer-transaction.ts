import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import { sendTransferAssetTransaction } from '@/app/azza/lib/azza.lib.transaction';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { logSync } from '@/resources/logger';

/**
 * This script is used to send a transfer asset transaction to the blockchain.
 * It is spawned in the background by the `WhatsAppBotTransactionConfirmationFlowService`.
 * It takes in a JSON stringified `TransferAssetTransactionDetails` object as an argument.
 * Script files should not be imported into other files. Or else, the script will be executed when the file is imported.
 */
const transactionParams: TransferAssetTransactionDetails = JSON.parse(process.argv[2]);

async function executeScript() {
    try {
        await sendTransferAssetTransaction(transactionParams);
    } catch (error) {
        logSync('error', 'Error executing transaction in background', { error });

        const message = MessageGenerators.generateTextMessage(
            transactionParams.userId,
            `An error occurred while sending your transaction. Please try again.`
        );
        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
    }
}

void executeScript();
