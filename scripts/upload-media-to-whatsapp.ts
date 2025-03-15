import * as fs from 'node:fs';
import WhatsAppBotService from '../src/app/WhatsAppBot/WhatsAppBotService';
import env from '../src/constants/env';
import path from 'node:path';

async function uploadMedia(filePath: string, fileName: string) {
    const fileBuffer = fs.readFileSync(filePath);
    const uploadedMedia = await WhatsAppBotService.uploadImageToWhatsapp(
        env.WA_PHONE_NUMBER_ID as string,
        new File([fileBuffer], fileName, {
            type: 'image/png',
        })
    );

    console.log(uploadedMedia);
}

async function run() {
    const filePath = process.argv[2];
    const fileName = path.basename(filePath);

    await uploadMedia(filePath, fileName);
}

run();
