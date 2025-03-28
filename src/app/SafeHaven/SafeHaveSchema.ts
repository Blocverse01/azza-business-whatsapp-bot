import { z } from 'zod';

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
    alias: string[];
    routingKey: string;
    logoImage: string | null;
    bankCode: string;
    categoryId: string;
    nubanCode: string | null;
}

export interface SupportedBankResponse {
    statusCode: number;
    responseCode: string;
    message: string;
    data: Bank[];
}
  
export interface AccessTokenResult {
    access_token: string;
    ibs_client_id: string;
}

export interface SupportedBankResult {
    name : string,
    slug : string
    bankCode : string,
}

interface BankAccountData {
    responseCode: string;
    responseMessage: string;
    sessionId: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    kycLevel: string;
    bvn: string;
}

export interface BankAccountVerificationResponse {
    statusCode: number;
    responseCode: string;
    message: string;
    data: BankAccountData;
}

export const accountNameEnquirySchema = z.object({
    bankCode: z.string().min(1, { message: "Bank code is required" }),
    accountNumber: z.string().min(10, { message: "Account number must be at least 10 digits" }),
});


