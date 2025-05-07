import {
    SwapTokensTransactionDetailsV2,
    TransferAssetTransactionDetails,
} from '@/app/azza/azza.schema';
import { SendTransferTransactionResponse } from '@/app/azza/lib/azza.lib.transaction';
import { OnrampTransactionPayload } from '@/app/FiatRamp/fiatRampSchema';
import {
    IncomingWhatsappMessage,
    PhoneNumberParams,
    WhatsAppTextMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import { AssetConfig } from '@/resources/web3/core/tokens';

export type FiatPayoutQueueResult =
    | {
          sequenceId: string;
          result: 'SENT';
      }
    | {
          error: string;
          result: 'FAILED' | 'REFUNDING_CRYPTO';
      };

export type CryptoDebitConfirmationQueueResult = {
    status: 'success' | 'failed' | 'dropped';
    transactionHash: string | null;
};
export type UserTxPinSecurityQueueInput =
    | {
          newPinHash: string;
          userId: string;
          encryptedSecurityQuestions: string;
          whatsappParams: PhoneNumberParams;
      }
    | {
          newPinHash: string;
          userId: string;
          whatsappParams: PhoneNumberParams;
      };
export type UserTxPinSecurityQueueResult = {
    status: 'success' | 'failed';
};

export enum QueueNames {
    fiatPayout = 'fiat-payout',
    fiatPayoutV2 = 'fiat-payout-v2',
    cryptoDebit = 'crypto-debit',
    cryptoDebitConfirmation = 'crypto-debit-confirmation',
    userTxPinSecurity = 'user-tx-pin-security',
    walletMigration = 'wallet-migration',
    whatsappBotMessaging = 'whatsapp-bot-messaging',
    whatsappBotMessagingTemp = 'whatsapp-bot-messaging-temp',
    whatsappBroadcast = 'whatsapp-broadcast',
    eventDrivenOfframp = 'event-driven-offramp',
    syncUserWallet = 'sync-user-wallet',
    baseCashback = 'base-cashback',
    cryptoPayout = 'crypto-payout',
    cleanupMessages = 'cleanup-messages',
    handleSmileKycWebhook = 'handle-smile-kyc-webhook',
    handleSafeHavenTransactionStatusUpdate = 'handle-safehaven-transaction-status-update',
    generateAzzaWrapped = 'generate-azza-wrapped',
    onRamp = 'onramp',
    blockradarAddressSwaps = 'blockradar-address-swaps',
}

export type UserWalletMigrationQueueInput = {
    oldUserId?: string;
    userPhoneNumber: string;
    businessPhoneNumberId: string;
};
export type UserWalletMigrationQueueResult = {
    walletIds: Array<string>;
};

export type CryptoDebitQueueInput = {
    transferDetails: TransferAssetTransactionDetails & {
        transactionPin: string;
    };
    whatsappParams: PhoneNumberParams;
};

export type CryptoDebitQueueResult = {
    transactionResponse: SendTransferTransactionResponse;
    whatsappParams: PhoneNumberParams | null;
};

export type CryptoDebitConfirmationQueueInput = {
    transactionResponse: SendTransferTransactionResponse;
    whatsappParams: PhoneNumberParams;
};

export type CryptoPayoutDebitConfirmationInput = {
    orderId: string;
    transactionId: string;
    asset: AssetConfig;
};

export type WhatsAppBotMessagingQueueInput = {
    message: IncomingWhatsappMessage;
    businessPhoneNumberId: string;
    displayName: string;
};

export type WhatsAppBotMessagingQueueResult = {
    actionExecuted: string;
};

export type WhatsappBroadcastQueueInput = {
    message: WhatsAppTextMessage;
    businessPhoneNumberId: string;
};

export type EventDrivenOfframpQueueInput = {
    offrampParams: {
        beneficiaryId: string;
        usdAmount: number;
        localAmount: number;
        userWalletAddress: string;
        hotWalletAddress: string;
        userId: string;
        platformFeePercentage: number;
        conversionRate: number;
        transactionFeeUsd: number;
        assetId: string;
        tokenAmountToDebit: number;
    };
    whatsappParams: PhoneNumberParams;
    transactionPin: string;
};
export type EventDrivenOfframpQueueResult = {
    offrampRequestId: string;
    debitTransactionId: string;
};

export type SyncUserWalletIdQueueInput = {
    userId: string;
    network: AllSupportedBlockchains;
    addressId: string;
    address: string;
};

export type SafeHavenTransactionQueueInput = {
    transactionId: string;
};

export type GenerateAzzaWrappedQueueInput = {
    userId: string;
    userDisplayName: string;
    whatsappParams: PhoneNumberParams;
};

export type OnRampQueueInput = {
    transactionPayload: OnrampTransactionPayload & {
        localCurrency: string;
    };
    whatsappParams: PhoneNumberParams;
};

export type BlockradarAddressSwapQueueInput = {
    swapDetails: SwapTokensTransactionDetailsV2;
    whatsappParams: PhoneNumberParams;
};
