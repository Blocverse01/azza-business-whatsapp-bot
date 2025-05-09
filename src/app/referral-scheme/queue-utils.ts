import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { queues } from '@/background-processing/queues';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { GenerateReferralCodeQueueInput, QueueNames } from '@/background-processing/types';
import { Worker } from 'bullmq';
import ReferralSchemeService from './service';
import { generateReferralCard, generateReferralStats } from './referral-generator';
import QRCode from 'qrcode';

export enum ReferralRank {
    NO_REFERRALS = 'NO_REFERRALS',
    TOP_10 = 'TOP_10',
    TOP_50 = 'TOP_50',
    TOP_100 = 'TOP_100',
}

export const ReferralRankMessages: Record<ReferralRank, string> = {
    [ReferralRank.NO_REFERRALS]: `🤷‍♂️ You still dey observe? \nNo dull, join the movement! 💨💰`,
    [ReferralRank.TOP_10]: `👑 You don enter big league! \nNa you dey burst everywhere with referral! \nKeep am up 🚀🔥`,
    [ReferralRank.TOP_50]: `🙌 You dey climb steady! \nYour referral game dey make sense. \nContinue like this, champion level near you! 🧗‍♂️✨`,
    [ReferralRank.TOP_100]:
        '🕺 You don enter top 100! 🔥 No be beans o – you sabi the road well well \n One more push and you go dey among the legends! 💪',
};

export function getReferralRank(position: number): ReferralRank {
    if (position === 0) return ReferralRank.NO_REFERRALS;
    if (position >= 1 && position <= 10) return ReferralRank.TOP_10;
    if (position > 10 && position <= 50) return ReferralRank.TOP_50;
    if (position > 50 && position <= 100) return ReferralRank.TOP_100;
    throw new Error('Position out of tracked range');
}

export const addJobToReferralCodeQueue = async (data: GenerateReferralCodeQueueInput) => {
    return await queues.generateReferralCode.add(`user-referral-code-${data.userId}`, data, {
        removeOnComplete: {
            age: 24 * 7 * 3600, // keep up to 7 days
            count: 1000, // keep up to 1000 jobs
        },
        removeOnFail: {
            age: 24 * 3 * 3600, // keep up to 3 days
        },
    });
};

const generateReferralCode = async () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let referralCode = '';
    for (let i = 0; i < 7; i++) {
        referralCode += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return referralCode.toUpperCase();
};

export const createReferralCodeWorker = () => {
    return new Worker<GenerateReferralCodeQueueInput>(
        QueueNames.generateReferralCode,
        async (job) => {
            return await handleReferralCodeJob(job.data);
        },
        {
            connection: connectionConfig,
            concurrency: 20,
        }
    );
};

const handleReferralCodeJob = async (data: GenerateReferralCodeQueueInput) => {
    const {
        userId,
        whatsappParams: { businessPhoneNumberId, userPhoneNumber },
        displayName,
    } = data;

    const validReferralScheme = await ReferralSchemeService.getReferralSchemeByUserId(userId);
    const referralCode = await generateReferralCode();

    const _generatedReferralCode = validReferralScheme?.code
        ? referralCode
        : (
              await ReferralSchemeService.createReferralCode({
                  userId,
                  code: referralCode,
              })
          ).code;

    const referralLink = `www.useazza.com/${_generatedReferralCode}`;

    //first referral message
    await WhatsAppBotService.sendWhatsappMessage(
        businessPhoneNumberId,
        MessageGenerators.generateTextMessage(
            userPhoneNumber,
            `Here’s your referral code, plus a message you can share with friends 👇🏽`
        )
    );

    try {
        const qrCode = await QRCode.toDataURL(referralLink, {
            errorCorrectionLevel: 'H',
            margin: 0, // 👈 removes the white padding
        });

        const imageBinary = await generateReferralCard({
            displayName,
            referralCode: _generatedReferralCode,
            qrCode,
        });
        const imageFile = new File([imageBinary], 'referral_code_card.png', { type: 'image/png' });
        const mediaResponse = await WhatsAppBotService.uploadImageToWhatsapp(
            businessPhoneNumberId,
            imageFile
        );

        if (!mediaResponse?.id) {
            return;
        }

        //second referral message with link
        const referralCard = await WhatsAppBotService.sendMediaMessage(
            { userPhoneNumber, businessPhoneNumberId },
            {
                mediaId: mediaResponse.id,
                caption: `\nJoin me on Azza – trade crypto seamlessly on WhatsApp.\n\nCheck it out: ${referralLink} \n`,
                type: 'image',
            }
        );

        //third referral message with stats button
        if (referralCard && referralCard.sent) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            await WhatsAppBotService.createReferralStatsMessage(
                businessPhoneNumberId,
                userPhoneNumber
            );
        }
    } catch (error) {
        throw error;
    }
};

export const handelReferralStats = async (params: {
    displayName: string;
    businessPhoneNumberId: string;
    totalReferred: string;
    userPhoneNumber: string;
    isNigeria: boolean;
}) => {
    const { displayName, businessPhoneNumberId, totalReferred, userPhoneNumber, isNigeria } =
        params;

    const userRank = getReferralRank(parseInt(totalReferred));
    const message = isNigeria
        ? ReferralRankMessages[userRank]
        : `Referral stats are here – keep up the amazing work!`;

    try {
        const imageBinary = await generateReferralStats({
            displayName,
            totalReferred,
        });

        const imageFile = new File([imageBinary], 'referral_stats_card.png', { type: 'image/png' });
        const mediaResponse = await WhatsAppBotService.uploadImageToWhatsapp(
            businessPhoneNumberId,
            imageFile
        );

        if (!mediaResponse?.id) {
            return;
        }

        await WhatsAppBotService.sendMediaMessage(
            { userPhoneNumber, businessPhoneNumberId },
            {
                mediaId: mediaResponse.id,
                caption: message,
                type: 'image',
            }
        );
    } catch (error) {
        throw error;
    }
};
