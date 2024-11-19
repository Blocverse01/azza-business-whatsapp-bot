import { SetTransactionPinParams } from '@/app/azza/azza.schema';
import { setTransactionPin } from '@/app/azza/lib/azza.lib.user-security';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { logSync } from '@/resources/logger';

const transactionParams: SetTransactionPinParams = JSON.parse(process.argv[2]);

async function executeScript(params: SetTransactionPinParams) {
    try {
        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            MessageGenerators.generateTextMessage(params.userId, '🚀 Setting transaction pin...')
        );

        const response = await setTransactionPin(params);

        if (response.pinSet) {
            const message = MessageGenerators.generateTextMessage(
                params.userId,
                '✅ Transaction pin has been successfully set.\n🫵 Only you should know your transaction pin, do not share it with anyone.'
            );

            await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

            process.exit(0);
        }

        process.exit(1);
    } catch (error) {
        logSync('error', 'Error setting transaction PIN', { error });

        const message = MessageGenerators.generateTextMessage(
            params.userId,
            `An error occurred while setting transaction pin. Please try again.`
        );
        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

        process.exit(2);
    }
}

void executeScript(transactionParams);
