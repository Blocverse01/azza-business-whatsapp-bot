import { OfframpTransactionRecord } from "../FiatRamp/fiatRampSchema";


export interface AuthTokenResult {
    success: boolean;
    message?: string;
    token: string;
}


interface Bank {
    code: string;
    name: string;
    id: string;
}

export interface SupportedBankResponse {
    success: boolean;
    message?: string;
    data: Bank[];
}

interface mobileProvider {
    id: string;
    name: string;
    currency: string;
    countryCode: string;
}

export interface MobileProviderListResponse {
    success: boolean;
    data: mobileProvider[];
}

interface Wallet {
    currency?: string;
    balance: number;
}

export interface AccountBalanceResponse {
    success: boolean;
    NGNWallet: Wallet;
    KESWallet: Wallet;
}


interface ConversionData {
    conversionRate: number;
    convertedAmount: number;
}

export interface ConversionResponse {
    success: boolean;
    message?: string;
    data: ConversionData;
}


export interface HoneyCoinPayoutResponse {
    success: boolean;
    message: string;
    transactionId: string;
}


export type HoneyCoinOfframpSettlement = Omit<OfframpTransactionRecord, 'createdAt' | 'status'>;


export type TxType = 'onramp' | 'offramp';
export type EventDataType = 'withdrew' | 'deposited';