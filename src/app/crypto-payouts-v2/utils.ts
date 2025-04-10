import crypto from 'node:crypto';
import { CryptoPayoutParams, CryptoPayoutQueueInput } from './types';
import platformWalletManager from '@/runtime/platform-wallets';
import { queues } from '@/background-processing/queues';
import { QueueNames } from '@/background-processing/types';
import { Worker } from 'bullmq';
import FiatRampService from '../FiatRamp/FiatRampService';
import azzaWalletManager from '@/runtime/wallet';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import { dbClient } from '@/db/dbClient';
import { CRYPTO_PAYOUT_REFERENCE_PREFIX } from '@/constants/strings';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import logger from '@/resources/logger';
import * as math from 'mathjs';
import SafeHavenService from '../SafeHaven/SafeHavenService';

const storeCryptoPayout = async (
    params: CryptoPayoutParams & {
        reference: string;
        transactionType: CryptoPayoutQueueInput['transactionType'];
    }
) => {
    const assetConfig = getAssetConfigOrThrow(params.assetId);

    return await dbClient.crypto_payout_v2.create(params.reference, {
        usdAmount: params.usdAmount,
        destinationWalletAddress: params.userWalletAddress,
        payoutType: params.transactionType,
        triggerTransactionId: params.targetTransactionHash,
        tokenSymbol: assetConfig.tokenName,
        blockchainNetwork: assetConfig.network,
    });
};

export const updateCryptoPayoutRecord = async (
    reference: string,
    updateable: {
        payoutTransactionHash?: string;
        status?: string;
    }
) => {
    return await dbClient.crypto_payout_v2.update(
        reference,
        {
            payoutTransactionHash: updateable.payoutTransactionHash,
            status: updateable.status,
        },
        ['payoutTransactionHash', 'status']
    );
};

export const getCryptoPayoutRecord = async (reference: string) => {
    return await dbClient.crypto_payout_v2.read(reference);
};

const generateTransactionReferenceId = (targetTransactionHash: string, prefix: string) => {
    const txHashSha256 = crypto.createHash('sha256').update(targetTransactionHash).digest('hex');
    const relevantParts = txHashSha256.slice(0, 16) + txHashSha256.slice(-8);
    return `${prefix}${relevantParts}`;
};

const ONRAMP_WALLET_USER_ID = 'onramp-payout';
const OFFRAMP_WALLET_USER_ID = 'offramp-hot-wallet';

export const processCryptoPayout = async (
    params: CryptoPayoutParams,
    transactionType: CryptoPayoutQueueInput['transactionType']
) => {
    const reference = generateTransactionReferenceId(
        params.targetTransactionHash,
        CRYPTO_PAYOUT_REFERENCE_PREFIX
    );

    const record = await storeCryptoPayout({
        reference,
        transactionType,
        ...params,
    });

    const transactionResponse = await platformWalletManager.withdrawAsset({
        assetId: params.assetId,
        userId:
            transactionType === 'onramp-payout' ? ONRAMP_WALLET_USER_ID : OFFRAMP_WALLET_USER_ID,
        amount: math.fix(params.usdAmount, 6).toString(),
        recipient: params.userWalletAddress,
        reference,
        metadata: {
            reason: transactionType,
        },
    });

    await record.update({
        status: 'pending',
    });

    return transactionResponse;
};

export const addCryptoPayoutJobToQueue = async (input: CryptoPayoutQueueInput) => {
    const jobId = `crypto-payout-${input.transactionId}`;
    return queues.cryptoPayout.add(jobId, input, {
        jobId,
        removeOnComplete: false,
    });
};

export const createCryptoPayoutWorker = () => {
    return new Worker<CryptoPayoutQueueInput>(
        QueueNames.cryptoPayout,
        async (job) => {
            const { transactionId, transactionType } = job.data;

            const transaction = await (async () => {
                if (transactionType === 'offramp-refund') {
                    return await FiatRampService.getOfframpTransaction(transactionId);
                }
                if (transactionType === 'offramp-safehaven-refund') {
                    return await SafeHavenService.getSafeHavenOfframpTransaction(transactionId);
                }
                if (transactionType === 'onramp-payout') {
                    return await FiatRampService.getOnrampTransaction(transactionId);
                }
                throw new Error(`Invalid transaction type: ${transactionType}`);
            })();

            if (!transaction) {
                throw Error(`Transaction with ID ${transactionId} not found`);
            }

            const canPayout =
                transactionType === 'offramp-refund' || 'offramp-safehaven-refund'
                    ? transaction.status === 'failed'
                    : transaction.status === 'complete';

            if (!canPayout) {
                throw new Error(`Payout not available for transaction`);
            }

            let transactionUsdAmount = transaction.usdAmount;

            if (transactionType === 'offramp-refund' || transactionType === 'offramp-safehaven-refund') {
                transactionUsdAmount += transaction.transactionFeeUsd;
            }

            const assetConfig = azzaWalletManager.searchAssets({
                tokenName: transaction.tokenSymbol,
                network: transaction.blockchainNetwork,
            })[0];

            const destinationWalletAddress =
                'fromWalletAddress' in transaction
                    ? transaction.fromWalletAddress
                    : transaction.destinationWalletAddress;

            if (!destinationWalletAddress) {
                throw Error(`Target transaction doesn't include a valid destination address`);
            }

            if (!transaction.sequenceId) {
                throw Error('Missing sequenceId');
            }

            const cashbackParams: CryptoPayoutParams = {
                usdAmount: transactionUsdAmount,
                userWalletAddress: destinationWalletAddress,
                targetTransactionHash: transaction.sequenceId,
                assetId: assetConfig.listItemId,
            };

            try {
                return await processCryptoPayout(cashbackParams, transactionType);
            } catch (error) {
                const parsedError = parseUnknownError(error);
                await logger.error(parsedError.message, {
                    error: parsedError,
                });

                throw error;
            }
        },
        {
            connection: connectionConfig,
            concurrency: 10,
        }
    );
};
