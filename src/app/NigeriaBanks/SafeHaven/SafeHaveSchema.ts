import { z } from 'zod';
import { OfframpTransactionRecord, transactionStatusSchema } from '../../FiatRamp/fiatRampSchema';

export interface AuthTokenResponse {
    access_token: string;
    client_id: string;
    token_type: "Bearer";
    expires_in: number;
    refresh_token: string;
    ibs_client_id: string;
    ibs_user_id: string;
}

interface Bank {
    name: string;
    bankCode: string;
}

export interface AccessTokenResult {
    access_token: string;
    ibs_client_id: string;
}

export interface SupportedBankResult {
    name: string,
    slug: string
    bankCode: string,
    routingKey: string
}

interface BankAccountData {
    responseCode: string;
    responseMessage: string;
    sessionId: string;
    bankCode: string;
    accountNumber: string;
    accountBank?: string;
    accountName: string;
    kycLevel: string;
    bvn: string;
}

export type SafeHavenOfframpSettlement = Omit<OfframpTransactionRecord, 'createdAt' | 'status'>;

interface BaseApiResponse<T> {
    statusCode: number;
    responseCode?: string;
    message: string;
    data: T;
}

export type BankAccountVerificationResponse = BaseApiResponse<BankAccountData>;

export type BankAccountBalance = BaseApiResponse<{
    accountBalance: number;
}>;

export type SupportedBankResponse = BaseApiResponse<Bank[]>;

export type TransactionResponse = BaseApiResponse<{
    queued: boolean;
    _id: string;
    client: string;
    account: string;
    type: "Outwards" | string;
    sessionId: string;
    nameEnquiryReference: string;
    paymentReference: string;
    mandateReference: string | null;
    isReversed: boolean;
    reversalReference: string | null;
    provider: string;
    providerChannel: string;
    providerChannelCode: string;
    destinationInstitutionCode: string;
    creditAccountName: string;
    creditAccountNumber: string;
    creditBankVerificationNumber: string | null;
    creditKYCLevel: string;
    debitAccountName: string;
    debitAccountNumber: string;
    debitBankVerificationNumber: string | null;
    debitKYCLevel: string;
    transactionLocation: string;
    narration: string;
    amount: number;
    fees: number;
    vat: number;
    stampDuty: number;
    responseCode: string;
    responseMessage: string;
    status: string;
    isDeleted: boolean;
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    __v: number;
}>

interface VasServiceCategory {
    _id: string;
    name: string;
    identifier: string;
    service: string;
    vendor: string;
    isFixedAmount: boolean;
    description: string;
    logoUrl: string;
    createdAt: string;
    updatedAt: string;
    __v: number;
}

export type VasServiceCategoriesResponse = BaseApiResponse<VasServiceCategory[]>;

interface VasAirtimeServiceCategoryProduct {
    validity: string;
    bundleCode: string;
    amount: string;
    isAmountFixed: boolean;
}

export type VasServiceCategoryProductsResponse = BaseApiResponse<VasAirtimeServiceCategoryProduct[]>;

export interface VasServiceCategoryProductWithId extends VasAirtimeServiceCategoryProduct {
    id: string;
}


const VasServiceCategorySchema = z.object({
    id: z.string(),
    name: z.string(),
    identifier: z.string(),
    serviceId: z.string(),
    isFixedAmount: z.boolean(),
    description: z.string(),
    logoUrl: z.string().url(),
});


export type VasServiceCategoryResult = z.infer<typeof VasServiceCategorySchema>;

export const VasAirtimeServiceCategoryProductSchema = z.object({
    validity: z.string(),
    bundleCode: z.string(),
    amount: z.string().refine(val => !isNaN(parseFloat(val)), {
        message: "Amount must be a valid number string",
    }),
    isAmountFixed: z.boolean(),
});


export type VasAirtimeServiceCategoryProductResult = z.infer<typeof VasAirtimeServiceCategoryProductSchema>;

export const accountNameEnquirySchema = z.object({
    bankCode: z.string().min(1, { message: "Bank code is required" }),
    accountNumber: z.string().min(10, { message: "Account number must be at least 10 digits" }),
});


const vasServiceSchema = z.object({
    id: z.string(),
    name: z.string(),
    identifier: z.enum(["UTILITY", "AIRTIME", "DATA"]),
    description: z.string(),
});

export const vasServicesSchema = z.array(vasServiceSchema);


const phoneNumberSchema = z.string()
    .min(10, 'Phone number must be at least 10 digits')
    .regex(/^[0-9]/, 'Phone number must contain only digits');

export const BaseVASPayloadSchema = z.object({
    amount: z.number().positive(),
    serviceCategoryId: z.string().min(1),
    distributionName: z.string().optional()
});

export const UtilityPayloadSchema = BaseVASPayloadSchema.extend({
    meterNumber: z.string().min(1, 'Meter number is required'),
    vendType: z.string().min(1, 'Vend type is required'),
});

export const AirtimePayloadSchema = BaseVASPayloadSchema.extend({
    phoneNumber: phoneNumberSchema
});

export const DataPayloadSchema = BaseVASPayloadSchema.extend({
    phoneNumber: phoneNumberSchema,
    bundleCode: z.string().min(1, 'Bundle code is required'),
});

export const VASServiceSchemas = {
    airtime: AirtimePayloadSchema,
    data: DataPayloadSchema,
    utility: UtilityPayloadSchema,
};


export interface ExecuteBuyTransactionPayload<T extends VASServiceType> {
    type: T;
    payload: z.infer<typeof PAYLOAD_SCHEMAS[T]>;
}

export type UtilityPayload = z.infer<typeof UtilityPayloadSchema>;
export type AirtimePayload = z.infer<typeof AirtimePayloadSchema>;
export type DataPayload = z.infer<typeof DataPayloadSchema>;

export type VasServicePayload = UtilityPayload | AirtimePayload | DataPayload;

export enum VASServiceType {
    UTILITY = 'utility',
    AIRTIME = 'airtime',
    DATA = 'data'
}


export const PAYLOAD_SCHEMAS: Record<VASServiceType, z.ZodSchema> = {
    [VASServiceType.UTILITY]: UtilityPayloadSchema,
    [VASServiceType.AIRTIME]: AirtimePayloadSchema,
    [VASServiceType.DATA]: DataPayloadSchema,
};

// Endpoint mapping
export const VAS_ENDPOINTS: Record<VASServiceType, string> = {
    [VASServiceType.UTILITY]: 'utility',
    [VASServiceType.AIRTIME]: 'airtime',
    [VASServiceType.DATA]: 'data'
};


export interface AirtimeOrDataReceiver {
    number: string;
    distribution: string;
    vendType: 'AIRTIME' | 'DATA';
}

export interface AirtimeOrDataResponseData {
    clientId: string;
    serviceCategoryId: string;
    reference: string;
    status: string;
    amount: number;
    id: string;
    receiver?: AirtimeOrDataReceiver;
}

export interface UtilityResponseData {
    clientId: string;
    serviceCategoryId: string;
    reference: string;
    status: string;
    amount: number;
    id: string;
    utilityToken: string;
}

export type AirtimeOrDataServiceResult = BaseApiResponse<AirtimeOrDataResponseData>;
export type UtilityServiceResult = BaseApiResponse<UtilityResponseData>;
export type VasServiceResult = AirtimeOrDataServiceResult | UtilityServiceResult;

export const ngnVasTransactionRecordSchema = z.object({
    status: transactionStatusSchema,
    blockchainNetwork: z.string(),
    usdAmount: z.number(),
    localAmount: z.number(),
    localCurrencySymbol: z.string(),
    tokenSymbol: z.string(),
    ownerId: z.string(),
    transactionHash: z.string().optional(),
    transactionFeeUsd: z.number().default(0),
    transactionType: z.nativeEnum(VASServiceType),
    recipient: z.object({
        country: z.string(),
        recipientMeterNumber: z.string().optional(),
        recipientPhoneNumber: z.string().optional(),
        serviceCategoryId: z.string().optional(),
        bundleCode: z.string().optional(),
        distributionName: z.string().optional()
    }),
    createdAt: z.string().datetime(),
    rate: z.number(),
    sequenceId: z.string().optional(),
    hotWalletAddress: z.string(),
    platformFeePercentage: z.number(),
    fromWalletAddress: z.string(),
    tokenAddress: z.string(),
    processorName: z.string()
});

export type ngnVasTransactionRecord = z.infer<typeof ngnVasTransactionRecordSchema>;
export type NGNVasPaymentSettlement = Omit<ngnVasTransactionRecord, 'createdAt' | 'status'>;


