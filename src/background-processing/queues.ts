import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import { SendTransferTransactionResponse } from '@/app/azza/lib/azza.lib.transaction';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { OfframpQueueFlowParams } from '@/background-processing/schema';
import {
    CryptoDebitConfirmationQueueInput,
    CryptoDebitConfirmationQueueResult,
    CryptoDebitQueueInput,
    CryptoDebitQueueResult,
    CryptoPayoutDebitConfirmationInput,
    FiatPayoutQueueResult,
    QueueNames,
    UserTxPinSecurityQueueInput,
    UserTxPinSecurityQueueResult,
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult,
    WhatsAppBotMessagingQueueInput,
    WhatsAppBotMessagingQueueResult,
} from '@/background-processing/types';
import { Queue } from 'bullmq';

export const queues = {
    fiatPayout: new Queue<OfframpQueueFlowParams, FiatPayoutQueueResult>(QueueNames.fiatPayout, {
        connection: connectionConfig,
    }),
    cryptoDebit: new Queue<
        Required<TransferAssetTransactionDetails> | CryptoDebitQueueInput,
        CryptoDebitQueueResult,
        'send-crypto' | 'offramp-debit' | 'user-funds-migration'
    >(QueueNames.cryptoDebit, {
        connection: connectionConfig,
    }),
    cryptoDebitConfirmation: new Queue<
        | SendTransferTransactionResponse
        | CryptoDebitConfirmationQueueInput
        | CryptoPayoutDebitConfirmationInput,
        CryptoDebitConfirmationQueueResult,
        | 'send-crypto-confirmation'
        | 'offramp-debit-confirmation'
        | 'user-funds-migration-confirmation'
        | 'crypto-payout-confirmation'
    >(QueueNames.cryptoDebitConfirmation, {
        connection: connectionConfig,
    }),
    userTxPinSecurity: new Queue<
        UserTxPinSecurityQueueInput,
        UserTxPinSecurityQueueResult,
        'set-tx-pin' | 'change-tx-pin'
    >(QueueNames.userTxPinSecurity, {
        connection: connectionConfig,
    }),
    walletMigration: new Queue<UserWalletMigrationQueueInput, UserWalletMigrationQueueResult>(
        QueueNames.walletMigration,
        {
            connection: connectionConfig,
        }
    ),
    whatsappBotMessaging: new Queue<
        WhatsAppBotMessagingQueueInput,
        WhatsAppBotMessagingQueueResult
    >(QueueNames.whatsappBotMessaging, {
        connection: connectionConfig,
    }),
};

export const defaultQueueRemoveOptions = {
    removeOnComplete: {
        age: 3600, // keep up to 1 hour
        count: 1000, // keep up to 1000 jobs
    },
    removeOnFail: {
        age: 24 * 3600, // keep up to 24 hours
    },
} as const;
