import { userIdentityInfoSchema } from '@/app/User/userSchema';
import { type CountryCode, isValidPhoneNumber } from 'libphonenumber-js';
import { z } from 'zod';

export const supportedCountry = z.object({
    code: z.string(),
    name: z.string(),
    currencyName: z.string(),
    currencySymbol: z.string(),
    flag: z.string().url(),
    id: z.string(),
});

const transactionFeesSchema = z.object({
    onrampFeePercentage: z.number(),
    offrampFeePercentage: z.number(),
    offrampMinFeeUsd: z.number(),
    conditionalFeePercentConfigs: z.array(
        z.object({
            rule: z.enum(['$gt', '$lt', '$gte'] as const),
            feePercentage: z.number(),
            triggerAmount: z.number(),
            rampType: z.enum(['onramp', 'offramp'] as const),
        })
    ),
});

export type TransactionFees = z.infer<typeof transactionFeesSchema>;

export const ratesSchema = z.object({
    buy: z.number(),
    sell: z.number(),
    locale: z.string(),
    code: z.string(),
});

export const quoteSchema = z.object({
    rate: ratesSchema,
    fees: transactionFeesSchema,
});

export const paymentMethodsResponseDataSchema = z.object({
    channels: z.array(
        z.object({
            channelName: z.enum(['bank', 'phone']),
            channelId: z.string(),
        })
    ),
    limits: z.object({
        min: z.number(),
        max: z.number(),
    }),
});

export const onrampTransactionPayloadSchema = z.object({
    country: z.string(),
    accountType: z.enum(['bank', 'phone']),
    localAmount: z.number(),
    accountNumber: z.string().optional(),
    channelId: z.string(),
    networkId: z.string().optional(),
    chainName: z.string(),
    tokenName: z.string(),
    userWalletAddress: z.string(),
    userDetails: userIdentityInfoSchema,
    customerId: z.string(),
    platformFeePercentage: z.number(),
    conversionRate: z.number(),
    usdAmount: z.number(),
    transactionFeeUsd: z.number(),
});

export type OnrampTransactionPayload = z.infer<typeof onrampTransactionPayloadSchema>;

export const sendOnrampTransactionResponseSchema = z.object({
    bankInfo: z
        .object({
            accountName: z.string(),
            accountNumber: z.string(),
            name: z.string(),
        })
        .optional(),
    narration: z.string().optional(),
    amount: z.coerce.number(),
    convertedAmount: z.number(),
    sequenceId: z.string(),
});

export type SendOnrampTransactionResponse = z.infer<typeof sendOnrampTransactionResponseSchema>;

export const resolveBankAccountSchema = z.object({
    accountName: z.string(),
    accountBank: z.string().optional(),
    accountNumber: z.string(),
    sessionId: z.string().optional(),
});

export const supportedPaymentNetworkSchema = z.object({
    networkId: z.string().min(3),
    channelId: z.string().min(3),
    name: z.string().min(3),
    seerbitId: z.string().min(3).optional(),
});

export type supportedPaymentNetworkType = z.infer<typeof supportedPaymentNetworkSchema>;

const beneficiaryCountrySchema = z.object({
    country: z.string(),
    code: z.string(),
    currencyName: z.string(),
    currencySymbol: z.string(),
});

export const bankBeneficiarySchema = z.object({
    accountName: z.string(),
    accountNumber: z.string(),
    bankName: z.string(),
    networkId: z.string(),
    channelId: z.string(),
    id: z.string(),
    countryId: z.string(),
    country: beneficiaryCountrySchema,
    seerbitId: z.string().optional(),
    nameEnquiryReference: z.string().optional(),
});

export const mobileMoneyBeneficiarySchema = (countryCode: CountryCode) =>
    z.object({
        firstName: z.string(),
        lastName: z.string(),
        networkId: z.string(),
        channelId: z.string(),
        id: z.string(),
        mobileProvider: z.string(),
        mobileNumber: z
            .string()
            .refine((data) => isValidPhoneNumber(data, countryCode), 'Invalid Mobile Number'),
        countryId: z.string(),
        country: beneficiaryCountrySchema,
    });

export type BankBeneficiary = z.infer<typeof bankBeneficiarySchema>;
export type MobileMoneyBeneficiary = z.infer<ReturnType<typeof mobileMoneyBeneficiarySchema>>;

export type Beneficiary = BankBeneficiary | MobileMoneyBeneficiary;
export type UsersBeneficiaries = Beneficiary[];

export const createBeneficiaryParams = (
    beneficiaryType: 'phone' | 'bank',
    countryCode: CountryCode
) =>
    z.object({
        beneficiary:
            beneficiaryType === 'phone'
                ? mobileMoneyBeneficiarySchema(countryCode).omit({ id: true, country: true })
                : bankBeneficiarySchema.omit({ id: true, country: true }),
    });

export type CreateBeneficiaryParams = z.infer<ReturnType<typeof createBeneficiaryParams>>;

export const createBeneficiaryResponseSchema = z.object({
    beneficiaryId: z.string(),
});

export const sendOfframpRequestPayloadSchema = z.object({
    beneficiaryId: z.string(),
    localAmount: z.number(),
    chainName: z.string(),
    tokenName: z.string(),
    userWalletAddress: z.string(),
    hotWalletAddress: z.string(),
    usdAmount: z.number(),
    tokenAddress: z.string(),
    txHash: z.string(),
    userId: z.string(),
    platformFeePercentage: z.number(),
    conversionRate: z.number(),
    transactionFeeUsd: z.number(),
});

export type SendOfframpRequestPayload = z.infer<typeof sendOfframpRequestPayloadSchema>;

export const transactionStatusSchema = z.enum([
    'pending',
    'complete',
    'failed',
    'processing',
    'created',
    'process',
    'recorded',
    'sent',
    'retried',
]);

export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

export const OfframpTransactionRecordSchema = z.object({
    status: transactionStatusSchema,
    blockchainNetwork: z.string(),
    usdAmount: z.number(),
    localAmount: z.number(),
    localCurrencySymbol: z.string(),
    tokenSymbol: z.string(),
    ownerId: z.string(),
    transactionHash: z.string(),
    transactionFeeUsd: z.number(),
    destination: z.object({
        accountName: z.string(),
        accountNumber: z.string(),
        networkName: z.string(),
        networkId: z.string(),
        country: z.string(),
        accountType: z.enum(['bank', 'phone']),
        seerbitId: z.string().optional(),
        nameEnquiryReference: z.string().optional(),
        channelId: z.string().optional(),
    }),
    createdAt: z.string().datetime(),
    rate: z.number(),
    sequenceId: z.string(),
    hotWalletAddress: z.string(),
    platformFeePercentage: z.number(),
    fromWalletAddress: z.string(),
    tokenAddress: z.string(),
});

export const onrampTransactionRecordSchema = z.object({
    status: transactionStatusSchema,
    blockchainNetwork: z.string(),
    usdAmount: z.number(),
    localAmount: z.number(),
    localCurrencySymbol: z.string(),
    tokenSymbol: z.string(),
    ownerId: z.string(),
    sequenceId: z.string(),
    destinationWalletAddress: z.string(),
    transactionFeeUsd: z.number(),
    collectionCountry: z.string(),
    createdAt: z.string().datetime(),
});

export type OfframpTransactionRecord = z.infer<typeof OfframpTransactionRecordSchema>;
export type OnrampTransactionRecord = z.infer<typeof onrampTransactionRecordSchema>;
