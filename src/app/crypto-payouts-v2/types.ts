export type CryptoPayoutParams = {
    usdAmount: number;
    userWalletAddress: string;
    targetTransactionHash: string;
    assetId: string;
};

export type CryptoPayoutQueueInput = {
    transactionId: string;
    transactionType: 'offramp-refund' | 'onramp-payout';
};
