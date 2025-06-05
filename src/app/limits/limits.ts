import { LimitedFeature } from '@/app/limits/types';

export const USAGE_LIMITS: Record<LimitedFeature, number> = {
    GASLESS_TRANSACTIONS: 3,
};
