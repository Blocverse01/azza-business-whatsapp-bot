import env from '@/constants/env';

export const connectionConfig = {
    url: env.REDIS_URL,
} as const;
