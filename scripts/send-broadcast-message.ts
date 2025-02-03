import MessageGenerators from '../src/app/WhatsAppBot/MessageGenerators';
import { sendWhatsappBroadcastMessage } from '../src/app/WhatsAppBot/messagingQueueHelpers';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';

async function sendBroadcastMessage(message: string) {
    const allUsers = await dbClient.user_v2
        .select(['primaryWhatsappPhoneNumber'])
        .filter({
            primaryWhatsappPhoneNumber: {
                $any: ['2348143100808', '2348146843432'],
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
    const message =
        'Gain access to all features like crypto-to-cash in just 1 minute by completing your KYC!\n' +
        '\n' +
        "Simply use your International Passport, driver's licence, or Voter’s Card to verify your identity.\n" +
        '\n' +
        '✅ Get started now with the */verify_me* command.\n' +
        '\n' +
        '❓ Need help? Join the Azza Community for support. https://chat.whatsapp.com/IYCiFBgpNtM1rCPhtBpv2c';
    await sendBroadcastMessage(message);
}

void runScript();
