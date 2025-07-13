import { sendWhatsappBroadcastMessage } from '../src/app/WhatsAppBot/messagingQueueHelpers';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';

const currentMediaLink =
    'https://res.cloudinary.com/dtfyyzwoz/image/upload/v1752419819/IMG_1803_ygazew.png';

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
                                link: currentMediaLink,
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
        '🔥 New Cashback Alert! 🔥',
        'Trade USDC/USDT on Solana and get 1.5% back instantly! 💸',
        'It’s fast, cheap, and now—rewarding.',
        'Start trading and start earning today.',
        'Powered by Azza x Solana 🚀',
    ].join('\n');

    await sendBroadcastMessage(message, onlyTo);
}

void runScript();
