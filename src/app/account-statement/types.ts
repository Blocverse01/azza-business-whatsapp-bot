export type TransactionType = 'onramp' | 'offramp';

export interface RawTransaction {
    usdAmount?: number | null;
    tokenSymbol?: string | null;
    blockchainNetwork?: string | null;
    destinationWalletAddress?: string;
    sequenceId?: string | null;
    referenceId?: string | null;
    xata?: {
        createdAt?: Date;
    };
    beneficiary?: {
        accountNumber?: string | null;
        networkName?: string | null;
        accountName?: string | null;
    };
    collectionAccountNumber?: string | null;
    collectionBankName?: string | null;
    collectionAccountName?: string | null;
    destinationAccountNumber?: string | null;
    destinationNetworkName?: string | null;
    destinationAccountName?: string | null;
}

interface WalletRecipient {
    type: 'Wallet';
    walletAddress: string;
}

interface BankRecipient {
    type: 'Bank';
    accountNumber: string;
    accountName: string;
    bankName: string;
}

type Recipient = WalletRecipient | BankRecipient;

export interface TransformedTransaction {
    date: string;
    time: string;
    type: 'Buy' | 'Sell';
    amount: string;
    chain: string;
    token: string;
    recipient: Recipient;
    reference: string;
}

export interface UserSummary {
    address: string;
    phoneNumber: string;
    fullName: string;
    totalTrades: number;
    totalVolumeUsd: number;
}

export interface TransactionsSummary {
    transactions: TransformedTransaction[];
    user: UserSummary
}
