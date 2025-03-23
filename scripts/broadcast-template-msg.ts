import { sendWhatsappBroadcastMessage } from '../src/app/WhatsAppBot/messagingQueueHelpers';
import {
    Template,
    TemplateMessageBase,
    TemplateNameSchema,
} from '../src/app/WhatsAppBot/templates/core/schema';
import { composeBvnKycReminderMessage } from '../src/app/WhatsAppBot/templates/bvn-kyc-reminder';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';
import * as readline from 'node:readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

async function broadcastTemplateMessage(templateName: Template['name'], onlyTo: string[] = []) {
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
            new Promise((resolve, reject) => {
                const phoneNumber = user.primaryWhatsappPhoneNumber;
                let message: TemplateMessageBase;

                if (templateName === 'bvn_kyc_reminder') {
                    message = composeBvnKycReminderMessage({
                        userId: user.id,
                        userPhoneNumber: phoneNumber,
                    });

                    resolve(
                        sendWhatsappBroadcastMessage({
                            message: message,
                            businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        })
                    );
                }

                reject('Unhandled template name');
            })
    );

    await Promise.all(sendSendMessagesPromises);

    console.log('Broadcast message queued to all users');
}

async function runScript() {
    rl.question('Enter template name: ', async (templateName) => {
        const onlyToString = process.argv[2];
        const onlyTo = onlyToString ? onlyToString.split(',') : [];

        const templateNameValidation = TemplateNameSchema.safeParse(templateName);

        if (!templateNameValidation.success) {
            console.log(`${templateName} is not a valid template`);
            return runScript();
        }

        await broadcastTemplateMessage(templateNameValidation.data, onlyTo);
    });
}

runScript();
