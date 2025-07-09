import { transactionStatusSchema } from "@/app/FiatRamp/fiatRampSchema";
import { z } from "zod";

export const P2pAgentTransactionSchema = z.object({
    blockchainNetwork: z.string(),
    localAmount: z.number().int(),
    ownerId: z.string(),
    usdAmount: z.number(),
    processingStatus: transactionStatusSchema,
    tokenSymbol: z.string(),
    transactionType: z.string(),
    beneficiaryId: z.string(),
    sequenceId: z.string(),
});

export type P2pAgentTransaction = z.infer<typeof P2pAgentTransactionSchema>;


export const P2pAgentTransactionParam = P2pAgentTransactionSchema.omit({
    beneficiaryId: true,
}).extend({
    rewardAmount: z.number(),
    rewardPercentage: z.number(),
    country: z.string(),
    localCurrencySymbol: z.string()
});


export type P2pAgentTransactionParams = z.infer<typeof P2pAgentTransactionParam>;

export const P2pAgentAccountBalanceSchema = z.object({
    previousBalance: z.string(),
    currentBalance: z.string(),
});

export type P2pAgentAccountBalance = z.infer<typeof P2pAgentAccountBalanceSchema>;
