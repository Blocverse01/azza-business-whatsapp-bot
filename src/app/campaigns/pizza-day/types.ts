export type PaymentTransactionDetails = {
    beneficiaryId: string;
    fiatAmount: number;
    usdAmount: number;
    transactionType: 'PAYMENT';
    userId: string;
    tokenAmountToDebit: number;
    conversionRate: number;
    transactionFeeUsd: number;
    platformFeePercentage: number;
    assetId: string;
};
