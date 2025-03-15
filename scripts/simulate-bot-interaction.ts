import { handleUserMessage } from '../src/app/WhatsAppBot/text/handleUserMessage';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';
import * as readline from 'node:readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

async function simulateBotInteraction(message: string, phoneNumber: string) {
    const user = await dbClient.user_v2
        .filter({ primaryWhatsappPhoneNumber: phoneNumber })
        .getFirst();

    if (!user) throw new Error('Invalid phone number');

    const result = await handleUserMessage({
        message,
        user,
        phoneParams: {
            userPhoneNumber: phoneNumber,
            businessPhoneNumberId: env.WA_PHONE_NUMBER_ID as string,
        },
    });

    return result;
}

const phoneNumber = process.argv[2];

async function runInteraction() {
    rl.question('[User]: ', async (message) => {
        if (message.trim() === '') {
            return runInteraction();
        }

        const result = await simulateBotInteraction(message, phoneNumber);

        console.log('[Assistant]: ', result.promptHandlerResponse.response);

        runInteraction();
    });
}

runInteraction();
