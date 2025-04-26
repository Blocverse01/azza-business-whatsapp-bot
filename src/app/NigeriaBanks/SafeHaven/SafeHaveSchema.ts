import { z } from 'zod';
import { OfframpTransactionRecord } from '../../FiatRamp/fiatRampSchema';

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
    responseCode: string;
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


export const accountNameEnquirySchema = z.object({
    bankCode: z.string().min(1, { message: "Bank code is required" }),
    accountNumber: z.string().min(10, { message: "Account number must be at least 10 digits" }),
});


