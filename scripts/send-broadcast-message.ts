import { sendWhatsappBroadcastMessage } from '../src/app/WhatsAppBot/messagingQueueHelpers';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';

const announcementBannerMediaId = '636062842503687';

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
                                id: announcementBannerMediaId,
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
        'Hello awesome user! 💙',
        'Thank you for your patience during our maintenance. Transactions and all services are now back online! 🚀\n',
        "If you haven't completed your KYC, use the /verify_me command to get started.",
        "And if you're already verified, go ahead and experience the speed of Azza! ⚡️",
    ].join('\n');

    await sendBroadcastMessage(message, onlyTo);
}

void runScript();
