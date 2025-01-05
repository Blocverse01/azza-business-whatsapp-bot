import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import { WAIT_FOR_TRANSACTION_RECEIPT_SCRIPT_PATH } from '@/app/azza/backgroundSpawns/script-paths';
import { spawnInBackground } from '@/app/azza/backgroundSpawns/spawn-in-background';
import { WaitForTransactionReceiptInBackgroundParams } from '@/app/azza/backgroundSpawns/wait-for-transaction-receipt';
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
        const [transaction, error] = await sendTransferAssetTransaction(transactionParams);

        if (error !== null) {
            await WhatsAppBotService.sendWhatsappMessage(
                env.WA_PHONE_NUMBER_ID,
                MessageGenerators.generateTextMessage(transactionParams.userId, error.message)
            );
            return;
        }

        const assetConfig = transaction.asset;
        const responseMessage = `⏳ Your transaction with the following details is being processed:\n\n🔀 Transfer ${transaction.transactionAmount} ${assetConfig.tokenName} on ${assetConfig.network} to ${transaction.destination}\n\n🆔 Request ID: ${transaction.transactionId}`;

        const message = MessageGenerators.generateTextMessage(
            transactionParams.userId,
            responseMessage
        );
        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

        spawnInBackground<WaitForTransactionReceiptInBackgroundParams>(
            {
                transactionId: transaction.transactionId,
                userId: transactionParams.userId,
                destination: transaction.destination,
                amount: transaction?.totalAmount.toString(),
                assetLabel: `${assetConfig.tokenName} on ${assetConfig.network}`,
                network: assetConfig.network,
            },
            WAIT_FOR_TRANSACTION_RECEIPT_SCRIPT_PATH
        );
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
