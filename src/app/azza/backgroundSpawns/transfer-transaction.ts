import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import { WAIT_FOR_TRANSACTION_RECEIPT_SCRIPT_PATH } from '@/app/azza/backgroundSpawns/script-paths';
import { spawnInBackground } from '@/app/azza/backgroundSpawns/spawn-in-background';
import { WaitForTransactionReceiptParams } from '@/app/azza/backgroundSpawns/wait-for-transaction-receipt';
import { sendTransferAssetTransaction } from '@/app/azza/lib/azza.lib.transaction';
import userServiceV2 from '@/app/runtime/user';
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
    const user = await userServiceV2.getUserById(transactionParams.userId);

    if (!user) {
        throw new Error(`Invalid user ID`);
    }
    const userPhoneNumber = user.primaryWhatsappPhoneNumber;

    try {
        const [transaction, error] = await sendTransferAssetTransaction(
            transactionParams,
            true,
            'new'
        );

        if (error !== null) {
            await WhatsAppBotService.sendWhatsappMessage(
                env.WA_PHONE_NUMBER_ID,
                MessageGenerators.generateTextMessage(userPhoneNumber, error.message)
            );
            return;
        }

        const assetConfig = transaction.asset;
        const responseMessage = `⏳ Your transaction with the following details is being processed:\n\n🔀 Transfer ${transaction.transactionAmount} ${assetConfig.tokenName} on ${assetConfig.network} to ${transaction.destination}\n\n🆔 Request ID: ${transaction.transactionId}`;

        const message = MessageGenerators.generateTextMessage(userPhoneNumber, responseMessage);
        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

        if (transaction) {
            spawnInBackground<WaitForTransactionReceiptParams>(
                {
                    transaction,
                    phoneParams: {
                        businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        userPhoneNumber: userPhoneNumber,
                    },
                },
                WAIT_FOR_TRANSACTION_RECEIPT_SCRIPT_PATH
            );
        }
    } catch (error) {
        logSync('error', 'Error executing transaction in background', { error });

        const message = MessageGenerators.generateTextMessage(
            userPhoneNumber,
            `An error occurred while sending your transaction. Please try again.`
        );
        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
    }
}

void executeScript();
