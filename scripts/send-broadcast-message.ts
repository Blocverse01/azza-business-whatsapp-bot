import { sendWhatsappBroadcastMessage } from '../src/app/WhatsAppBot/messagingQueueHelpers';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';

const mediaId = '1145583560637144';

async function sendBroadcastMessage(message: string, onlyTo: string[] = []) {
    const allUsers =
        onlyTo.length > 0
            ? await dbClient.user_v2
                  .select(['primaryWhatsappPhoneNumber'])
                  .filter({
                      primaryWhatsappPhoneNumber: {
                          $any: onlyTo,
                      },
                  })
                  .getAll()
            : await dbClient.user_v2.select(['primaryWhatsappPhoneNumber']).getAll();

    const sendSendMessagesPromises = allUsers.map(
        (user) =>
            new Promise((resolve) => {
                const phoneNumber = user.primaryWhatsappPhoneNumber!;

                resolve(
                    sendWhatsappBroadcastMessage({
                        message: {
                            messaging_product: 'whatsapp',
                            recipient_type: 'individual',
                            to: phoneNumber,
                            type: 'image',
                            image: {
                                id: mediaId,
                                caption: message,
                            },
                        },
                        businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                    })
                );
            })
    );

    await Promise.all(sendSendMessagesPromises);

    console.log('Broadcast message queued to all users');
}

async function runScript() {
    const onlyToString = process.argv[2];

    const onlyTo = onlyToString ? onlyToString.split(',') : [];

    const message = [
        'You are now qualified to earn *1%* *cashback* every time you buy or sell *USDC* on *BASE*.This offer is only available on *AZZA*\n',
        'Start trading now and earn cashback on every transaction! 🚀',
    ].join('\n');

    await sendBroadcastMessage(message, onlyTo);
}

void runScript();
