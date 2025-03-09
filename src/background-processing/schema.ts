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
    transactionFeeUsd: z.number(),
    whatsappParams: z.object({
        userPhoneNumber: z.string(),
        businessPhoneNumberId: z.string(),
    }),
});

export const OfframpQueueFlowSchemaV2 = OfframpQueueFlowSchema.merge(
    z.object({
        txHash: z.string(),
    })
);

export type OfframpQueueFlowParams = z.infer<typeof OfframpQueueFlowSchema>;
export type OfframpQueueFlowParamsV2 = z.infer<typeof OfframpQueueFlowSchemaV2>;
