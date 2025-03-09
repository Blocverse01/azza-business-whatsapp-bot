import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import { SendTransferTransactionResponse } from '@/app/azza/lib/azza.lib.transaction';
import {
    IncomingWhatsappMessage,
    PhoneNumberParams,
    WhatsAppTextMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
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
    };
    whatsappParams: PhoneNumberParams;
    transactionPin: string;
};
export type EventDrivenOfframpQueueResult = {
    offrampRequestId: string;
    debitTransactionId: string;
};
