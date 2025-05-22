export type PercentageCashbackParams = {
    tradeAmountUsd: number;
    userWalletAddress: string;
    targetTransactionHash: string;
    cashbackPercentage: number;
    assetId: string;
};

export type PercentageCashbackQueueInput = {
    transactionId: string;
    transactionType: 'offramp' | 'manual-offramp' | 'safehaven-offramp';
};
