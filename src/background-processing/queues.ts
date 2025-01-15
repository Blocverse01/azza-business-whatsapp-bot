import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import {
    SendTransferTransactionResponse,
    SendTransferTransactionResult,
} from '@/app/azza/lib/azza.lib.transaction';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { OfframpQueueFlowParams } from '@/background-processing/schema';
import {
    CryptoDebitConfirmationQueueResult,
    FiatPayoutQueueResult,
    QueueNames,
    UserTxPinSecurityQueueInput,
    UserTxPinSecurityQueueResult,
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult,
} from '@/background-processing/types';
import { Queue } from 'bullmq';

export const queues = {
    fiatPayout: new Queue<OfframpQueueFlowParams, FiatPayoutQueueResult>(QueueNames.fiatPayout, {
        connection: connectionConfig,
    }),
    cryptoDebit: new Queue<
        Required<TransferAssetTransactionDetails>,
        SendTransferTransactionResult,
        'send-crypto' | 'offramp-debit' | 'user-funds-migration'
    >(QueueNames.cryptoDebit, {
        connection: connectionConfig,
    }),
    cryptoDebitConfirmation: new Queue<
        SendTransferTransactionResponse,
        CryptoDebitConfirmationQueueResult,
        | 'send-crypto-confirmation'
        | 'offramp-debit-confirmation'
        | 'user-funds-migration-confirmation'
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
};
