import { z } from "zod";
import {
    AirtimePayload,
    DataPayload,
    UtilityPayload,
    VASServiceType
} from "../NigeriaBanks/SafeHaven/SafeHaveSchema";

export const transactionType = 'NGN_VAS_PAYMENT' as const;
export type TransactionType = typeof transactionType;

export type PaymentTransactionDetails = {
    transactionDetailsParams: {
        beneficiaryId: string;
        fiatAmount: number;
        usdAmount: number;
        transactionPin: string;
        transactionType: TransactionType;
        userId: string;
        tokenAmountToDebit: number;
        conversionRate: number;
        transactionFeeUsd: number;
        platformFeePercentage: number;
        assetId: string;
        userPhoneNumber: string;
    },
    ngnVasDetailsParams?: {
        type: VASServiceType;
        payload: AirtimePayload | DataPayload | UtilityPayload;
        distributionName?: string
    };
};


export type RecipientInfo = {
    country: string;
    recipientMeterNumber?: string;
    recipientPhoneNumber?: string;
    serviceCategoryId?: string;
    bundleCode?: string;
    distributionName?: string;
};
export { AirtimePayload, DataPayload, UtilityPayload };

