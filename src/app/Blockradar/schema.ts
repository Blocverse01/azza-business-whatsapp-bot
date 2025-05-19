import { z } from 'zod';

export const blockradarBaseApiResponseSchema = z.object({
    statusCode: z.number(),
    message: z.string(),
    data: z.unknown().optional().nullable(),
});

const datesSchema = z.object({
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});
const blockradarNetworkSchema = z.enum(['testnet', 'mainnet'] as const);
const amlScreeningSchema = z.object({
    message: z.string().optional().nullable(),
    provider: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
});
const blockradarTransactionStatusSchema = z.enum(['PENDING', 'SUCCESS', 'FAILED'] as const);
const blockradarTransactionTypeSchema = z.enum(['WITHDRAW', 'DEPOSIT', 'SALVAGE', 'SWAP'] as const);

export const blockradarBlockchainSchema = z
    .object({
        derivationPath: z.string(),
        id: z.string(),
        isActive: z.boolean(),
        isEvmCompatible: z.boolean(),
        logoUrl: z.string().url().optional().nullable(),
        name: z.string(),
        slug: z.string(),
        symbol: z.string(),
        tokenStandard: z.string().optional().nullable(),
    })
    .merge(datesSchema);

export const blockradarAddressConfigurationsSchema = z.object({
    aml: amlScreeningSchema,
    disableAutoSweep: z.boolean(),
    enableGaslessWithdraw: z.boolean(),
    showPrivateKey: z.boolean(),
});

export const blockradarAddressSchema = z
    .object({
        address: z.string(),
        blockchain: blockradarBlockchainSchema.optional(),
        isActive: z.boolean(),
        network: blockradarNetworkSchema,
        id: z.string(),
        name: z.string().nullable(),
        derivationPath: z.string(),
        configurations: blockradarAddressConfigurationsSchema,
        metadata: z.record(z.string()).nullable(),
    })
    .merge(datesSchema);

const blockradarAssetSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        symbol: z.string(),
        decimals: z.number(),
        address: z.string(),
        standard: z.string().optional().nullable(),
        isActive: z.boolean(),
        logoUrl: z.string().url().optional().nullable(),
        network: blockradarNetworkSchema,
        blockchain: blockradarBlockchainSchema.optional().nullable(),
    })
    .merge(datesSchema);

export const blockradarAddressBalanceSchema = z.object({
    asset: z.object({
        id: z.string(),
        asset: blockradarAssetSchema,
    }),
    balance: z.string(),
    convertedBalance: z.string(),
});

export const blockradarAddressBalancesSchema = z.array(blockradarAddressBalanceSchema);

const commonTransactionFieldsSchema = z.object({
    amlScreening: amlScreeningSchema.optional().nullable(),
    amount: z.string(),
    amountPaid: z.string(),
    asset: blockradarAssetSchema,
    assetSwept: z.boolean().optional().nullable(),
    assetSweptAmount: z.string().optional().nullable(),
    assetSweptAt: z.string().optional().nullable(),
    assetSweptGasFee: z.string().optional().nullable(),
    assetSweptHash: z.string().optional().nullable(),
    assetSweptRecipientAddress: z.string().optional().nullable(),
    assetSweptResponse: z.string().optional().nullable(),
    assetSweptSenderAddress: z.string().optional().nullable(),
    blockHash: z.string().optional().nullable(),
    blockNumber: z.number().optional().nullable(),
    blockchain: blockradarBlockchainSchema,
    chainId: z.number().optional().nullable(),
    confirmations: z.number().optional().nullable(),
    confirmed: z.boolean(),
    currency: z.string(),
    fee: z.string().optional().nullable(),
    gasFee: z.string().optional().nullable(),
    gasPrice: z.string().optional().nullable(),
    gasUsed: z.string().optional().nullable(),
    hash: z.string().optional().nullable(),
    id: z.string(),
    metadata: z.record(z.string()).optional().nullable(),
    network: blockradarNetworkSchema,
    note: z.string().optional().nullable(),
    reason: z.string().optional().nullable(),
    recipientAddress: z.string(),
    senderAddress: z.string(),
    status: blockradarTransactionStatusSchema,
    tokenAddress: z.string().optional().nullable(),
    type: blockradarTransactionTypeSchema,
    reference: z.string().optional().nullable(),
});

export const blockradarTransactionSchema = commonTransactionFieldsSchema
    .omit({
        assetSweptResponse: true,
        tokenAddress: true,
    })
    .extend({
        address: blockradarAddressSchema,
    })
    .merge(datesSchema);

/////////////////////////
// Request payloads
/////////////////////////
export const generateAddressRequestBodySchema = z.object({
    disableAutoSweep: z.boolean().optional(),
    enableGaslessWithdraw: z.boolean().optional(),
    name: z.string().optional(),
    showPrivateKey: z.boolean().optional(),
    metadata: z.record(z.string()).optional(),
});
export const updateAddressRequestBodySchema = z.object({
    disableAutoSweep: z.boolean().optional(),
    enableGaslessWithdraw: z.boolean().optional(),
    isActive: z.boolean(),
    name: z.string().optional(),
    showPrivateKey: z.boolean().optional(),
});
export const withdrawAssetRequestBodySchema = z.object({
    address: z.string(),
    amount: z.string(),
    assetId: z.string(),
    reference: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
});

//////////////////////
// Responses
//////////////////////
export const withdrawAssetResponseDataSchema = commonTransactionFieldsSchema
    .extend({
        wallet: z.object({ id: z.string() }),
    })
    .merge(datesSchema);
export const withdrawNetworkFeeResponseDataSchema = z.object({
    networkFee: z.string(),
    nativeBalance: z.string(),
    networkFeeInUSD: z.string(),
});

////////////////////////
// Webhook Payload
////////////////////////
const webhookEvent = z.enum([
    'deposit.success',
    'withdraw.success',
    'withdraw.failed',
    'swap.success',
    'swap.failed',
] as const);
export const blockradarWebhookPayloadSchema = z.object({
    event: webhookEvent,
    data: z.object({
        id: z.string(),
        reference: z.string(),
        senderAddress: z.string(),
        recipientAddress: z.string(),
        amount: z.string(),
        amountPaid: z.string(),
        network: blockradarNetworkSchema,
        metadata: z.record(z.string()).nullable(),
        asset: blockradarAssetSchema,
        address: blockradarAddressSchema,
        blockchain: blockradarBlockchainSchema,
        hash: z.string(),
    }),
});

export const swapQuoteRequestBodySchema = z.object({
    fromAssetId: z.string().nonempty(),
    toAssetId: z.string().nonempty(),
    amount: z.string(),
    recipientAddress: z.string().optional(),
});

export const swapQuoteResponseDataSchema = z.object({
    amount: z.string(),
    estimatedArrivalTime: z.number(),
    networkFee: z.string(),
    rate: z.string(),
});

export const executeSwapRequestBodySchema = swapQuoteRequestBodySchema.extend({
    reference: z.string(),
    metadata: z.record(z.string()).optional().nullable(),
});
export const executeSwapResponseDataSchema = z.object({
    amount: z.string(),
    blockHash: z.string().optional().nullable(),
    blockNumber: z.number().optional().nullable(),
    blockchain: blockradarBlockchainSchema,
    confirmations: z.number().optional().nullable(),
    confirmed: z.boolean(),
    hash: z.string().optional().nullable(),
    id: z.string(),
    status: blockradarTransactionStatusSchema,
    rate: z.string(),
    toAmount: z.string(),
    network: blockradarNetworkSchema,
    type: blockradarTransactionTypeSchema,
});

//////////////////////
// Types
//////////////////////
export type GenerateAddressRequestBody = z.infer<typeof generateAddressRequestBodySchema>;
export type UpdateAddressRequestBody = z.infer<typeof updateAddressRequestBodySchema>;
export type WithdrawAssetRequestBody = z.infer<typeof withdrawAssetRequestBodySchema>;
export type BlockradarWebhookPayload = z.infer<typeof blockradarWebhookPayloadSchema>;
export type BlockradarAddress = z.infer<typeof blockradarAddressSchema>;
export type BlockradarTransactionType = z.infer<typeof blockradarTransactionTypeSchema>;
export type SwapQuoteRequestBody = z.infer<typeof swapQuoteRequestBodySchema>;
export type SwapQuoteResponseData = z.infer<typeof swapQuoteResponseDataSchema>;
export type ExecuteSwapRequestBody = z.infer<typeof executeSwapRequestBodySchema>;
export type ExecuteSwapResponseData = z.infer<typeof executeSwapResponseDataSchema>;
