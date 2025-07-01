import { sendWhatsappBroadcastMessage } from '../src/app/WhatsAppBot/messagingQueueHelpers';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';

const currentMediaLink =
    'https://res.cloudinary.com/dltnruk3l/image/upload/v1750532378/IMG-20250621-WA0007_wchpt7.jpg';

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
        'Azza’s first-ever Community Call is here.',
        'Join us this Saturday as we walk you through what we’ve built, what’s coming next, and answer all your questions.',
        '🗓️ Saturday, June 21 — 8:00PM WAT',
        '📍 X Space: https://x.com/i/spaces/1MYGNwPvoBnJw',
    ].join('\n');

    await sendBroadcastMessage(message, onlyTo);
}

void runScript();
