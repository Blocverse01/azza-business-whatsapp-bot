import { z } from 'zod';

export const OfframpQueueFlowSchema = z.object({
    beneficiaryId: z.string(),
    localAmount: z.number(),
    chainName: z.string(),
    tokenName: z.string(),
    userWalletAddress: z.string(),
    hotWalletAddress: z.string(),
    usdAmount: z.number(),
    tokenAddress: z.string(),
    userId: z.string(),
    platformFeePercentage: z.number(),
    conversionRate: z.number(),
});

export type OfframpQueueFlowParams = z.infer<typeof OfframpQueueFlowSchema>;
