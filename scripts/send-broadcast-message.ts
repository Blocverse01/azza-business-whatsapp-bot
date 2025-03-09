import MessageGenerators from '../src/app/WhatsAppBot/MessageGenerators';
import { sendWhatsappBroadcastMessage } from '../src/app/WhatsAppBot/messagingQueueHelpers';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';

async function sendBroadcastMessage(message: string) {
    const allUsers = await dbClient.user_v2
        .select(['primaryWhatsappPhoneNumber'])
        .filter({
            primaryWhatsappPhoneNumber: {
                $any: ['2348143100808', '2348115857771'],
            },
        })
        .getAll();
    const sendSendMessagesPromises = allUsers.map(
        (user) =>
            new Promise((resolve) => {
                const phoneNumber = user.primaryWhatsappPhoneNumber!;
                const messageObject = MessageGenerators.generateTextMessage(phoneNumber, message);
                const businessPhoneNumberId = env.WA_PHONE_NUMBER_ID;

                resolve(
                    sendWhatsappBroadcastMessage({
                        message: messageObject,
                        businessPhoneNumberId,
                    })
                );
            })
    );

    await Promise.all(sendSendMessagesPromises);

    console.log('Broadcast message queued to all users');
}

async function runScript() {
    const message = [
        'Hello amazing user💙',
        'We’re currently performing maintenance on the AZZA bot, and during this time, transactions will be temporarily unavailable.',
        'This maintenance is expected to last approximately 3 hours.',
        'Stay connected with us by joining our early users’ community:',
        'https://chat.whatsapp.com/IYCiFBgpNtM1rCPhtBpv2c',
        'Thank you for your patience!⚡️',
    ].join('\n');

    await sendBroadcastMessage(message);
}

void runScript();
