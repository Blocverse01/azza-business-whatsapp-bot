import { SwapTokensOnBaseTransactionDetails } from '@/app/azza/azza.schema';
import { sendTokenSwapTransactionOnBase } from '@/app/azza/lib/azza.lib.swap-on-base';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { logSync } from '@/resources/logger';

/**
 * This script is used to send a token swap transaction to the blockchain.
 * It takes in a JSON stringified `SwapTokensOnBaseTransactionDetails` object as an argument.
 * Script files should not be imported into other files. Or else, the script will be executed when the file is imported.
 */
const swapParams: SwapTokensOnBaseTransactionDetails = JSON.parse(process.argv[2]);

async function executeScript() {
    try {
        await sendTokenSwapTransactionOnBase(swapParams);
    } catch (error) {
        logSync('error', 'Error executing transaction in background', { error });

        const message = MessageGenerators.generateTextMessage(
            swapParams.userId,
            `An error occurred while sending your transaction. Please try again.`
        );
        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
    }
}

void executeScript();
