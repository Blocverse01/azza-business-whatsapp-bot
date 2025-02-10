import { supportedBlockchainChainSchema } from '@/resources/web3/core/blockchains';
import { z } from 'zod';

export const transactionPinSchema = z.string().min(4).max(6).describe('The transaction pin.');

export enum AssetTransferRecipientType {
    WALLET_ADDRESS = 'WALLET_ADDRESS',
    PHONE_NUMBER = 'PHONE_NUMBER',
}

export const assetTransferRecipientTypeSchema = z
    .nativeEnum(AssetTransferRecipientType)
    .describe(
        'The recipient type for the asset transfer, either a wallet address or phone number.'
    );

export const supportedTransactionTypes = z
    .enum(['SEND', 'BUY', 'SELL'])
    .describe('The supported transaction types.');

export const transferAssetTransactionDetailsSchema = z.object({
    transactionType: z.literal('SEND').describe('The type of transaction.'),
    recipient: z
        .string()
        .describe(
            'The recipient wallet address or phone number to send to. If the recipient is a phone number, ensure it is in the international format.'
        ),
    recipientType: assetTransferRecipientTypeSchema,
    amount: z.number().describe('The amount of cryptocurrency to transfer.'),
    assetId: z.string().describe('The ID of the asset to transfer.'),
    transactionFee: z.coerce.number().describe('The transaction fee for the transfer.'),
    userId: z.string().describe('The ID of the user initiating the transfer.'),
    transactionPin: transactionPinSchema.optional(),
});

export const transferProcessingModeSchema = z
    .enum(['direct', 'claimable'])
    .describe('The processing mode for the transfer.');

export const securityQuestionSchema = z.object({
    question: z.string(),
    answer: z.string(),
    immutableId: z.string(), // Once a security question has been used for at least user, the system should never change this so that the user can always answer the question. This is useful for deciding which questions to display in the reset flow on WhatsApp.
});

export const setTransactionPinParamsSchema = z.object({
    userId: z.string().describe('The ID of the user setting the transaction pin.'),
    newPinHash: z.string(),
    encryptedSecurityQuestions: z.string(),
});

export const changeTransactionPinParamsSchema = z.object({
    userId: z.string(),
    newPinHash: z.string(),
});

export const baseNameSchema = z
    .custom<`${string}.base.eth`>()
    .refine((data) => data.endsWith('.base.eth'), {
        message: 'Invalid Base Name',
    });

export const tokenMetadataSchema = z.object({
    name: z.string(),
    symbol: z.string(),
    id: z.string(),
    decimals: z.coerce.number(),
});

export const swapTokensOnBaseTransactionDetailsSchema = z.object({
    transactionType: z.literal('SWAP_TOKENS_ON_BASE'),
    userId: z.string(),
    fromToken: tokenMetadataSchema,
    toToken: tokenMetadataSchema,
    fromAmount: z.string(),
    approvalAddress: z.string().optional(),
    transactionRequest: z.object({
        to: z.string().optional(),
        from: z.string().optional(),
        data: z.string().optional(),
        value: z.string().optional(),
    }),
    transactionPin: transactionPinSchema.optional(),
});

export const swapTokensTransactionDetailsSchema = z.object({
    transactionType: z.literal('SWAP_TOKENS'),
    userId: z.string(),
    fromToken: tokenMetadataSchema,
    toToken: tokenMetadataSchema,
    fromAmount: z.string(),
    transactionRequest: z.object({
        to: z.string().optional(),
        from: z.string().optional(),
        data: z.string().optional(),
        value: z.string().optional(),
    }),
    transactionPin: transactionPinSchema.optional(),
    fromChain: supportedBlockchainChainSchema,
    toChain: supportedBlockchainChainSchema,
    approvalAddress: z.string().optional(),
});

////////////////////
// Inferred Types
////////////////////
export type TransferAssetTransactionDetails = z.infer<typeof transferAssetTransactionDetailsSchema>;
export type SupportedTransactionTypes = z.infer<typeof supportedTransactionTypes>;
export type TransferProcessingMode = z.infer<typeof transferProcessingModeSchema>;
export type SetTransactionPinParams = z.infer<typeof setTransactionPinParamsSchema>;
export type SecurityQuestion = z.infer<typeof securityQuestionSchema>;
export type ChangeTransactionPinParams = z.infer<typeof changeTransactionPinParamsSchema>;
export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;
export type SwapTokensOnBaseTransactionDetails = z.infer<
    typeof swapTokensOnBaseTransactionDetailsSchema
>;
export type SwapTokensTransactionDetails = z.infer<typeof swapTokensTransactionDetailsSchema>;
