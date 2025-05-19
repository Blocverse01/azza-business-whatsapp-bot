import { USAGE_LIMITS } from '@/app/limits/limits';
import { LimitedFeature } from '@/app/limits/types';
import { dbClient, sqlClient } from '@/db/dbClient';
import { DailyFeatureLimitRecord } from '@/db/xata';

export async function hasExceededLimit(userId: string, feature: LimitedFeature) {
    const userLimit = await dbClient.daily_feature_limit
        .filter({
            feature,
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
    await sqlClient<Array<DailyFeatureLimitRecord>>`UPDATE daily_feature_limit SET usageCount = 0`;
}
