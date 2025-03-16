import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import { SendTransferTransactionResponse } from '@/app/azza/lib/azza.lib.transaction';
import { PercentageCashbackQueueInput } from '@/app/campaigns/base-cashbacks/types';
import { CryptoPayoutQueueInput } from '@/app/crypto-payouts-v2/types';
import { SmileIdWebhookData } from '@/app/SmileID/smile-id-schema';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { OfframpQueueFlowParams, OfframpQueueFlowParamsV2 } from '@/background-processing/schema';
import {
    CryptoDebitConfirmationQueueInput,
    CryptoDebitConfirmationQueueResult,
    CryptoDebitQueueInput,
    CryptoDebitQueueResult,
    CryptoPayoutDebitConfirmationInput,
    EventDrivenOfframpQueueInput,
    EventDrivenOfframpQueueResult,
    FiatPayoutQueueResult,
    QueueNames,
    SyncUserWalletIdQueueInput,
    UserTxPinSecurityQueueInput,
    UserTxPinSecurityQueueResult,
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult,
    WhatsAppBotMessagingQueueInput,
    WhatsAppBotMessagingQueueResult,
    WhatsappBroadcastQueueInput,
} from '@/background-processing/types';
import { Queue } from 'bullmq';

export const queues = {
    fiatPayout: new Queue<OfframpQueueFlowParams, FiatPayoutQueueResult>(QueueNames.fiatPayout, {
        connection: connectionConfig,
    }),
    fiatPayoutV2: new Queue<OfframpQueueFlowParamsV2, FiatPayoutQueueResult>(
        QueueNames.fiatPayoutV2,
        {
            connection: connectionConfig,
        }
    ),
    eventDrivenOfframp: new Queue<EventDrivenOfframpQueueInput, EventDrivenOfframpQueueResult>(
        QueueNames.eventDrivenOfframp,
        {
            connection: connectionConfig,
        }
    ),
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
    whatsappBotMessagingTemp: new Queue<
        WhatsAppBotMessagingQueueInput,
        WhatsAppBotMessagingQueueResult
    >(QueueNames.whatsappBotMessagingTemp, {
        connection: connectionConfig,
    }),
    whatsappBroadcast: new Queue<WhatsappBroadcastQueueInput>(QueueNames.whatsappBroadcast, {
        connection: connectionConfig,
    }),
    syncUserWallet: new Queue<SyncUserWalletIdQueueInput>(QueueNames.syncUserWallet, {
        connection: connectionConfig,
    }),
    baseCashback: new Queue<PercentageCashbackQueueInput>(QueueNames.baseCashback, {
        connection: connectionConfig,
    }),
    cryptoPayout: new Queue<CryptoPayoutQueueInput>(QueueNames.cryptoPayout, {
        connection: connectionConfig,
    }),
    cleanupMessages: new Queue(QueueNames.cleanupMessages, {
        connection: connectionConfig,
    }),
    handleSmileKycWebhook: new Queue<SmileIdWebhookData>(QueueNames.handleSmileKycWebhook, {
        connection: connectionConfig,
    }),
};

export const defaultQueueRemoveOptions = {
    removeOnComplete: {
        age: 24 * 3600, // keep up to 1 day
        count: 1000, // keep up to 1000 jobs
    },
    removeOnFail: {
        age: 48 * 3600, // keep up to 2 days
    },
} as const;
