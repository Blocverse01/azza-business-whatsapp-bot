import type { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import type { SendTransferTransactionResponse } from '@/app/azza/lib/azza.lib.transaction';
import type { PercentageCashbackQueueInput } from '@/app/campaigns/base-cashbacks/types';
import type { CryptoPayoutQueueInput } from '@/app/crypto-payouts-v2/types';
import type {
    SmileIdWebhookData,
    BvnKycVerificationWebhookBody,
} from '@/app/SmileID/smile-id-schema';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import type {
    OfframpQueueFlowParams,
    OfframpQueueFlowParamsV2,
} from '@/background-processing/schema';
import {
    BlockradarAddressSwapQueueInput,
    CryptoDebitConfirmationQueueInput,
    CryptoDebitConfirmationQueueResult,
    CryptoDebitQueueInput,
    CryptoDebitQueueResult,
    CryptoPayoutDebitConfirmationInput,
    EventDrivenOfframpQueueInput,
    EventDrivenOfframpQueueResult,
    FiatPayoutQueueResult,
    GenerateAzzaWrappedQueueInput,
    OnRampQueueInput,
    QueueNames,
    NGNBankTransactionQueueInput,
    SyncUserWalletIdQueueInput,
    UserTxPinSecurityQueueInput,
    UserTxPinSecurityQueueResult,
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult,
    WhatsAppBotMessagingQueueInput,
    WhatsAppBotMessagingQueueResult,
    WhatsappBroadcastQueueInput,
    GenerateReferralCodeQueueInput,
    CollectFeeQueueInput,
    GenerateAccountStatementQueueInput,
    NGNVasTransactionQueueInput,
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
    handleSmileKycWebhook: new Queue<SmileIdWebhookData | BvnKycVerificationWebhookBody>(
        QueueNames.handleSmileKycWebhook,
        {
            connection: connectionConfig,
        }
    ),
    handleNGNBankTransactionStatusUpdate: new Queue<NGNBankTransactionQueueInput>(
        QueueNames.handleNGNBankTransactionStatusUpdate,
        {
            connection: connectionConfig,
        }
    ),
    handleNGNVasTransactionStatusUpdate: new Queue<NGNVasTransactionQueueInput>(
        QueueNames.handleNGNVasTransactionStatusUpdate,
        {
            connection: connectionConfig,
        }
    ),
    generateAzzaWrapped: new Queue<GenerateAzzaWrappedQueueInput>(QueueNames.generateAzzaWrapped, {
        connection: connectionConfig,
    }),
    onRamp: new Queue<OnRampQueueInput>(QueueNames.onRamp, {
        connection: connectionConfig,
    }),
    blockradarAddressSwaps: new Queue<BlockradarAddressSwapQueueInput>(
        QueueNames.blockradarAddressSwaps,
        {
            connection: connectionConfig,
        }
    ),
    generateReferralCode: new Queue<GenerateReferralCodeQueueInput>(
        QueueNames.generateReferralCode,
        {
            connection: connectionConfig,
        }
    ),
    feeCollection: new Queue<CollectFeeQueueInput>(QueueNames.feeCollection, {
        connection: connectionConfig,
    }),
    resetFeatureUsageLimit: new Queue(QueueNames.resetFeatureUsageLimit, {
        connection: connectionConfig,
    }),
    pizzaDayCashback: new Queue<PercentageCashbackQueueInput>(QueueNames.pizzaDayCashback, {
        connection: connectionConfig,
    }),
    dailyRatesUpdate: new Queue(QueueNames.dailyRatesUpdate, {
        connection: connectionConfig,
    }),
    generateAccountStatement: new Queue<GenerateAccountStatementQueueInput>(
        QueueNames.generateAccountStatement,
        {
            connection: connectionConfig,
        }
    )
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
