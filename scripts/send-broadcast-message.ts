import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import { sendWhatsappBroadcastMessage } from '../src/app/WhatsAppBot/messagingQueueHelpers';
import WhatsAppBotService from '../src/app/WhatsAppBot/WhatsAppBotService';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';

const ASSET_FOLDER = 'assets';
const FILE_NAME = 'announcement_banner.png';
const mediaId = '636062842503687';

async function uploadMedia(path: string) {
    const announcementInfo = fs.readFileSync(path.resolve(process.cwd(), ASSET_FOLDER, FILE_NAME));
    const uploadedMedia = await WhatsAppBotService.uploadImageToWhatsapp(
        env.WA_PHONE_NUMBER_ID,
        new File([Buffer.from(announcementInfo)], FILE_NAME, {
            type: 'image/png',
        })
    );

    console.log(uploadedMedia);
}

async function sendBroadcastMessage(message: string, onlyTo = []) {
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
        'Hello awesome user! 💙',
        'Thank you for your patience during our maintenance. Transactions and all services are now back online! 🚀\n',
        "If you haven't completed your KYC, use the /verify_me command to get started.",
        "And if you're already verified, go ahead and experience the speed of Azza! ⚡️",
    ].join('\n');

    await sendBroadcastMessage(message, onlyTo);
}

void runScript();
