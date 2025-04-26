import { OfframpTransactionRecord } from "../../FiatRamp/fiatRampSchema";


export interface GenerateTokenResponse {
    success: boolean;
    message: string;
    token: string;
    expiry: string;
}

export interface AccessTokenResult {
    access_token: string
}

export type BellOfframpSettlement = Omit<OfframpTransactionRecord, 'createdAt' | 'status'>;
