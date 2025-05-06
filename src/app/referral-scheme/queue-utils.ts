import { getUserStatsAndRank } from '@/app/campaigns/azza-wrapped/analytics';
import { generateTradingRankCard } from '@/app/campaigns/azza-wrapped/rank-card-generator';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { queues } from '@/background-processing/queues';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { GenerateReferralCodeQueueInput, QueueNames } from '@/background-processing/types';
import { Worker } from 'bullmq';
import ReferralSchemeService from './service';

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

const generateReferralCode = () => {
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
    const { userId, whatsappParams } = data;

    let generatedReferralCode = '';

    const validReferralScheme = await ReferralSchemeService.getReferralSchemeByUserId(userId);

    if (!validReferralScheme) {

        const code = generateReferralCode();
        const record = await ReferralSchemeService.createReferralCode({
            userId,
            code
        });

        generatedReferralCode = record.code;
    }

    generatedReferralCode = validReferralScheme?.code as string;

    const referralLink = `https://www.useazza.com/${generatedReferralCode}`;
    await WhatsAppBotService.sendWhatsappMessage(
        whatsappParams.businessPhoneNumberId,
        MessageGenerators.generateTextMessage(
            whatsappParams.userPhoneNumber,
            `Here's your referral link: ${referralLink}`
        )
    );


};
