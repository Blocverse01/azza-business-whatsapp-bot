import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import process from 'node:process';
import readline from 'node:readline';
import { sendWhatsappBroadcastMessage } from '../src/app/WhatsAppBot/messagingQueueHelpers';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';

async function sendBroadcastMessage(message: string) {
    const allUsers = await dbClient.user_v2.getAll();

    for (const user of allUsers) {
        const phoneNumber = user.primaryWhatsappPhoneNumber!;
        const messageObject = MessageGenerators.generateTextMessage(phoneNumber, message);
        const businessPhoneNumberId = env.WA_PHONE_NUMBER_ID;

        await sendWhatsappBroadcastMessage({
            message: messageObject,
            businessPhoneNumberId,
        });
    }

    console.log('Broadcast message queued to all users');
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function runScript() {
    rl.question(
        'Enter the cache keys to clear (separate multi keys with a comma): ',
        async (message) => {
            if (!message) {
                console.error('No message provided');
                process.exit(1);
            }

            await sendBroadcastMessage(message);
            rl.close();
        }
    );
}

void runScript();
