import { OfframpTransactionRecord } from "../../FiatRamp/fiatRampSchema";


export interface GenerateTokenResponse {
    success: boolean;
    message: string;
    token: string;
    expiry: string;
}

export interface TransactionResponse {
    success: boolean;
    message: string;
    data: {
        netAmount: number;
        details: Record<string, any>;
        id: number;
        userId: number;
        accountId: number | null;
        amount: string;
        charge: string;
        description: string;
        destinationAccountNumber: string;
        destinationAccountName: string;
        destinationBankCode: string;
        destinationBankName: string;
        sourceAccountNumber: string;
        sourceAccountName: string;
        sourceBankCode: string;
        sourceBankName: string;
        reference: string;
        transactionTypeName: string;
        stampDuty: number | null;
        sessionId: string;
        status: string;
        reversedFlag: number;
        category: string;
        utilityType: string | null;
        type: string;
        completedAt: number;
        createdAt: number;
        updatedAt: number;
    };
}

export interface AccessTokenResult {
    access_token: string
}

export type BellOfframpSettlement = Omit<OfframpTransactionRecord, 'createdAt' | 'status'>;
