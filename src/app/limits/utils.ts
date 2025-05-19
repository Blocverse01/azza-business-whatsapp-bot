import { USAGE_LIMITS } from '@/app/limits/limits';
import { LimitedFeature } from '@/app/limits/types';
import { queues } from '@/background-processing/queues';
import { QueueNames } from '@/background-processing/types';
import { dbClient, sqlClient } from '@/db/dbClient';
import { DailyFeatureLimitRecord } from '@/db/xata';
import { ConnectionOptions, Worker } from 'bullmq';

export async function hasExceededLimit(userId: string, feature: LimitedFeature) {
    const userLimit = await dbClient.daily_feature_limit
        .filter({
            feature,
            user: userId,
        })
        .getFirst();

    if (!userLimit) {
        return false;
    }
    return userLimit.usageCount >= USAGE_LIMITS[feature];
}

export async function createOrIncrementUsageCount(userId: string, feature: LimitedFeature) {
    const generatedId = `${userId}_${feature.toLowerCase()}`;

    return await dbClient.daily_feature_limit.createOrUpdate(generatedId, {
        user: userId,
        usageCount: { $increment: 1 },
        feature,
    });
}

export async function resetAllUsageLimits() {
    await sqlClient<
        Array<DailyFeatureLimitRecord>
    >`UPDATE daily_feature_limit SET 'usageCount' = 0`;
}

export const prepareLimitResetSchedulerQueue = async () => {
    await queues.resetFeatureUsageLimit.upsertJobScheduler(
        'reset-limits-every-24-hours',
        {
            every: 86_400_000, // Job will repeat every 24 hours
        },
        {
            name: 'Reset Feature Usage Limits',
        }
    );
};
export const createResetFeatureUsageLimitWorker = (connection: ConnectionOptions) => {
    return new Worker(
        QueueNames.resetFeatureUsageLimit,
        async () => {
            await resetAllUsageLimits();
        },
        {
            connection,
        }
    );
};
