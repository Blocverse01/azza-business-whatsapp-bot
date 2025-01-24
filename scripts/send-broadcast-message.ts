import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
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

async function runScript() {
    const message =
        'Hey Azza User,\n' +
        '\n' +
        'We had some issues with naira payouts earlier, but it’s all sorted now! You can continue transacting seamlessly.\n' +
        '\n' +
        'Thanks for sticking with us—you’re awesome!\n' +
        '\n' +
        'Cheers,\n' +
        'The Azza Team';
    await sendBroadcastMessage(message);
}

void runScript();
