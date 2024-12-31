import { SwapTokensTransactionDetails } from '@/app/azza/azza.schema';
import { sendSwapTransaction } from '@/app/azza/lib/azza.lib.swap-tokens';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import logger from '@/resources/logger';

/**
 * This script is used to send a token swap transaction to the blockchain.
 * It takes in a JSON stringified `SwapTokensTransactionDetails` object as an argument.
 * Script files should not be imported into other files. Or else, the script will be executed when the file is imported.
 */
const swapParams: SwapTokensTransactionDetails = JSON.parse(process.argv[2]);

async function executeScript() {
    try {
        await sendSwapTransaction(swapParams);
    } catch (error) {
        console.log('Error executing transaction in background', error);

        const message = MessageGenerators.generateTextMessage(
            swapParams.userId,
            `An error occurred while sending your transaction. Please try again.`
        );
        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

        process.exit(2);
    }
}

void executeScript();
