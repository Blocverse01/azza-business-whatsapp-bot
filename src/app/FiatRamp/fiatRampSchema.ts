import { z } from 'zod';
import { type CountryCode, isValidPhoneNumber } from 'libphonenumber-js';

export const supportedCountry = z.object({
    code: z.string(),
    name: z.string(),
    currencyName: z.string(),
    currencySymbol: z.string(),
    flag: z.string().url(),
    id: z.string(),
});

export const getCurrenciesResponseSchema = z.object({
    data: z.array(
        z.object({
            code: z.string(),
            name: z.string(),
            currencyName: z.string(),
            currencySymbol: z.string(),
            flag: z.string().url(),
            id: z.string(),
        })
    ),
});

export type GetCurrenciesResponse = z.infer<typeof getCurrenciesResponseSchema>;

const transactionFeesSchema = z.object({
    onrampFeePercentage: z.number(),
    offrampFeePercentage: z.number(),
});

export const getTransactionFeeResponseSchema = z.object({
    data: transactionFeesSchema,
});

export type GetTransactionFeeResponse = z.infer<typeof getTransactionFeeResponseSchema>;

export const ratesSchema = z.object({
    buy: z.number(),
    sell: z.number(),
    locale: z.string(),
    code: z.string(),
});

export const getRateResponseSchema = z.object({
    data: ratesSchema,
});

export type GetRateResponse = z.infer<typeof getRateResponseSchema>;

export const getAllRatesResponseSchema = z.object({
    data: z.array(ratesSchema),
});

export type GetAllRatesResponse = z.infer<typeof getAllRatesResponseSchema>;

export const quoteSchema = z.object({
    rate: ratesSchema,
    fees: transactionFeesSchema,
});

export const getQuoteResponseSchema = z.object({
    data: quoteSchema,
});

export type GetQuoteResponse = z.infer<typeof getQuoteResponseSchema>;

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

export const getPaymentMethodsResponseSchema = z.object({
    data: paymentMethodsResponseDataSchema,
});

export type GetPaymentMethodsResponse = z.infer<typeof getPaymentMethodsResponseSchema>;

export const getMobileProvidersResponseSchema = z.object({
    data: z.array(
        z.object({
            channelId: z.string(),
            networkId: z.string(),
            name: z.string(),
        })
    ),
});

export type GetMobileProvidersResponse = z.infer<typeof getMobileProvidersResponseSchema>;

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
    userDetails: z.object({
        phoneNumber: z.string(),
        kycDocumentNumber: z.string(),
        kycIdType: z.string(),
        kycDateOfBirth: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        address: z.string().optional(),
        country: z.string(),
    }),
    customerId: z.string(),
});

export type OnrampTransactionPayload = z.infer<typeof onrampTransactionPayloadSchema>;

export const sendOnrampTransactionResponseSchema = z.object({
    data: z.object({
        bankInfo: z
            .object({
                accountName: z.string(),
                accountNumber: z.string(),
                name: z.string(),
            })
            .optional(),
        narration: z.string(),
        amount: z.string(),
        sequenceId: z.string(),
    }),
});

export type SendOnrampTransactionResponse = z.infer<typeof sendOnrampTransactionResponseSchema>;

export const supportedPaymentNetworkSchema = z.object({
    networkId: z.string().min(3),
    channelId: z.string().min(3),
    name: z.string().min(3),
});

export type SupportedPaymentNetwork = z.infer<typeof supportedPaymentNetworkSchema>;

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

type Beneficiary = BankBeneficiary | MobileMoneyBeneficiary;
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

export type CreateBeneficiaryResponse = z.infer<typeof createBeneficiaryResponseSchema>;

export const getBeneficiariesResponseSchema = (
    countryCode: CountryCode,
    beneficiaryType: 'phone' | 'bank'
) =>
    z.object({
        data: z.array(
            beneficiaryType === 'phone'
                ? mobileMoneyBeneficiarySchema(countryCode)
                : bankBeneficiarySchema
        ),
    });

export type GetBeneficiariesResponse = z.infer<ReturnType<typeof getBeneficiariesResponseSchema>>;

export const getBeneficiaryResponseSchema = (
    countryCode: CountryCode,
    beneficiaryType: 'phone' | 'bank'
) =>
    z.object({
        data:
            beneficiaryType === 'phone'
                ? mobileMoneyBeneficiarySchema(countryCode)
                : bankBeneficiarySchema,
    });

export type GetBeneficiaryResponse = z.infer<ReturnType<typeof getBeneficiaryResponseSchema>>;

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
});

export type SendOfframpRequestPayload = z.infer<typeof sendOfframpRequestPayloadSchema>;

export const sendOfframpRequestResponseSchema = z.object({
    data: z.object({
        offrampRequestId: z.string(),
    }),
});

export type SendOfframpRequestResponse = z.infer<typeof sendOfframpRequestResponseSchema>;

export const postOfframpTransactionResponse = z.object({
    data: z.object({
        sequenceId: z.string(),
    }),
});

export type PostOfframpTransactionResponse = z.infer<typeof postOfframpTransactionResponse>;

export const transactionStatusSchema = z.enum([
    'pending',
    'complete',
    'failed',
    'processing',
    'created',
]);

export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

const getTransactionStatusResponseSchema = z.object({
    data: z.object({
        transactionStatus: transactionStatusSchema,
    }),
});

export type GetTransactionStatusResponse = z.infer<typeof getTransactionStatusResponseSchema>;

export const transactionWebhookPayloadSchema = z.object({
    sequenceId: z.string(),
    transactionStatus: transactionStatusSchema,
    transactionOwnerId: z.string(),
    transactionType: z.union([z.literal('on-ramp'), z.literal('off-ramp')]),
    localAmount: z.number(),
    usdAmount: z.number(),
    chainName: z.string(),
    tokenName: z.string(),
    localCurrencySymbol: z.string(),
    beneficiaryId: z.string().optional(),
    destinationWalletAddress: z.string().optional(),
});

export type TransactionWebhookPayload = z.infer<typeof transactionWebhookPayloadSchema>;
