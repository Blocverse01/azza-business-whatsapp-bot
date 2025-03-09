import { z } from 'zod';

export const blockradarBaseApiResponseSchema = z.object({
    statusCode: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
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
const blockradarTransactionTypeSchema = z.enum(['WITHDRAW', 'DEPOSIT', 'SALVAGE'] as const);

export const blockradarBlockchainSchema = z
    .object({
        derivationPath: z.string(),
        id: z.string(),
        isActive: z.boolean(),
        isEvmCompatible: z.boolean(),
        logoUrl: z.string().url().optional(),
        name: z.string(),
        slug: z.string(),
        symbol: z.string(),
        tokenStandard: z.string().nullable(),
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
        standard: z.string().nullable(),
        isActive: z.boolean(),
        logoUrl: z.string().url(),
        network: blockradarNetworkSchema,
        blockchain: blockradarBlockchainSchema.optional(),
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
    amlScreening: amlScreeningSchema.nullable(),
    amount: z.string(),
    amountPaid: z.string(),
    asset: blockradarAssetSchema,
    assetSwept: z.boolean().nullable(),
    assetSweptAmount: z.string().nullable(),
    assetSweptAt: z.string().nullable(),
    assetSweptGasFee: z.string().nullable(),
    assetSweptHash: z.string().nullable(),
    assetSweptRecipientAddress: z.string().nullable(),
    assetSweptResponse: z.string().nullable(),
    assetSweptSenderAddress: z.string().nullable(),
    blockHash: z.string().nullable(),
    blockNumber: z.number().nullable(),
    blockchain: blockradarBlockchainSchema,
    chainId: z.number().nullable(),
    confirmations: z.number().nullable(),
    confirmed: z.boolean(),
    currency: z.string(),
    fee: z.string().nullable(),
    gasFee: z.string().nullable(),
    gasPrice: z.string().nullable(),
    gasUsed: z.string().nullable(),
    hash: z.string().nullable(),
    id: z.string(),
    metadata: z.record(z.string()).nullable(),
    network: blockradarNetworkSchema,
    note: z.string().nullable(),
    reason: z.string().nullable(),
    recipientAddress: z.string(),
    senderAddress: z.string(),
    status: blockradarTransactionStatusSchema,
    tokenAddress: z.string().nullable(),
    type: blockradarTransactionTypeSchema,
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

////////////////////////
// Webhook Payload
////////////////////////
const webhookEvent = z.enum(['deposit.success', 'withdraw.success'] as const);
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

//////////////////////
// Types
//////////////////////
export type GenerateAddressRequestBody = z.infer<typeof generateAddressRequestBodySchema>;
export type UpdateAddressRequestBody = z.infer<typeof updateAddressRequestBodySchema>;
export type WithdrawAssetRequestBody = z.infer<typeof withdrawAssetRequestBodySchema>;
export type BlockradarWebhookPayload = z.infer<typeof blockradarWebhookPayloadSchema>;
