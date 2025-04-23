import { getUserStatsAndRank } from '@/app/campaigns/azza-wrapped/analytics';
import { generateTradingRankCard } from '@/app/campaigns/azza-wrapped/rank-card-generator';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { queues } from '@/background-processing/queues';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { GenerateAzzaWrappedQueueInput, QueueNames } from '@/background-processing/types';
import { Worker } from 'bullmq';

export const addJobToAzzaWrappedQueue = async (data: GenerateAzzaWrappedQueueInput) => {
    return await queues.generateAzzaWrapped.add(`user-wrap-${data.userId}`, data, {
        removeOnComplete: {
            age: 24 * 7 * 3600, // keep up to 7 days
            count: 1000, // keep up to 1000 jobs
        },
        removeOnFail: {
            age: 24 * 3 * 3600, // keep up to 3 days
        },
    });
};

export const createAzzaWrappedWorker = () => {
    return new Worker<GenerateAzzaWrappedQueueInput>(
        QueueNames.generateAzzaWrapped,
        async (job) => {
            return await handleAzzaWrappedJob(job.data);
        },
        {
            connection: connectionConfig,
            concurrency: 20,
        }
    );
};

const handleAzzaWrappedJob = async (data: GenerateAzzaWrappedQueueInput) => {
    const { userId, userDisplayName, whatsappParams } = data;

    await WhatsAppBotService.sendWhatsappMessage(
        whatsappParams.businessPhoneNumberId,
        MessageGenerators.generateTextMessage(
            whatsappParams.userPhoneNumber,
            `Crunching the numbers, decoding the trades, and unlocking your Azza Wrapped... 🧠📊 Hang tight, ${userDisplayName} – your rank reveal is moments away! 🚀`
        )
    );

    const rankParams = await getUserStatsAndRank(userId);
    const wrappedImage = await generateTradingRankCard({
        rank: rankParams.rank,
        stats: rankParams.stats,
        displayName: userDisplayName,
    });

    const imageFile = new File([wrappedImage], `user-wrapped-${userId}`, { type: 'image/png' });
    const mediaResponse = await WhatsAppBotService.uploadImageToWhatsapp(
        whatsappParams.businessPhoneNumberId,
        imageFile
    );

    if (!mediaResponse?.id) {
        return;
    }

    await WhatsAppBotService.sendMediaMessage(whatsappParams, {
        mediaId: mediaResponse.id,
        caption: `You made this moment possible, ${userDisplayName} 🎉\n\nSee how you helped shape our journey — and flex it on your socials! 🚀💛`,
        type: 'image',
    });
};
