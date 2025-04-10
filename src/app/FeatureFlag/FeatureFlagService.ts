import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import { dbClient } from '@/db/dbClient';

class FeatureFlagService {
    public static async isFeatureEnabled(featureKey: FeatureFlagKey): Promise<boolean> {
        const featureFlag = await dbClient.feature_flag
            .filter({
                key: featureKey,
            })
            .getFirst();

        return featureFlag?.isEnabled ?? false;
    }
}

export default FeatureFlagService;
