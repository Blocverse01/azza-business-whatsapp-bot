import { sendTechnicalIssueAlert } from '@/app/support/whatsapp';
import env from '@/constants/env';
import { CryptoPayoutV2Record } from '@/db/xata';
import { clipDecimal } from '@/resources/utils/transformers';
import { SelectedPick } from '@xata.io/client';
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
import NigeriaBanksService from '../NigeriaBanks/NigeriaBanksService';
import HoneyCoinService from '../HoneyCoin/HoneyCoinService';
import SafeHavenService from '../NigeriaBanks/SafeHaven/SafeHavenService';

const storeCryptoPayout = async (
    params: CryptoPayoutParams & {
        reference: string;
        transactionType: CryptoPayoutQueueInput['transactionType'];
    }
) => {
    const assetConfig = getAssetConfigOrThrow(params.assetId);

    return await dbClient.crypto_payout_v2.create(params.reference, {
        usdAmount: params.amount,
        destinationWalletAddress: params.userWalletAddress,
        payoutType: params.transactionType,
        triggerTransactionId: params.targetTransactionHash,
        tokenSymbol: assetConfig.tokenName,
        blockchainNetwork: assetConfig.network,
    });
};

export const updateCryptoPayoutRecord = async (
    reference: string,
    updatable: {
        payoutTransactionHash?: string;
        status?: string;
    }
) => {
    return await dbClient.crypto_payout_v2.update(
        reference,
        {
            payoutTransactionHash: updatable.payoutTransactionHash,
            status: updatable.status,
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
    const platformWalletUserId =
        transactionType === 'onramp-payout' ? ONRAMP_WALLET_USER_ID : OFFRAMP_WALLET_USER_ID;

    const currentAssetBalance = await platformWalletManager.getAssetBalance({
        userId: platformWalletUserId,
        assetId: params.assetId,
    });
    const amountToTransfer = clipDecimal(params.amount, 6);

    if (currentAssetBalance.balance < amountToTransfer) {
        const alertMessage = `*Crypto Payout Alert*\n\n_Insufficient ${params.assetId} balance for ${transactionType}._\n\nAvailable Balance: ${currentAssetBalance.balance}\nRequired Balance: ${amountToTransfer}`;

        await sendTechnicalIssueAlert(alertMessage, env.WA_PHONE_NUMBER_ID);

        throw new Error(alertMessage);
    }

    let recordToProcess: SelectedPick<CryptoPayoutV2Record, ['*']>;

    const existingRecord = await getCryptoPayoutRecord(reference);

    if (existingRecord && existingRecord.status === 'created') {
        recordToProcess = existingRecord;
    } else {
        recordToProcess = await storeCryptoPayout({
            reference,
            transactionType,
            ...params,
        });
    }

    const transactionResponse = await platformWalletManager.withdrawAsset({
        assetId: params.assetId,
        userId: platformWalletUserId,
        amount: amountToTransfer.toString(),
        recipient: params.userWalletAddress,
        reference,
        metadata: {
            reason: transactionType,
        },
    });

    await recordToProcess.update({
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
                if (transactionType === 'offramp-ngn-bank-refund') {
                    return await NigeriaBanksService.getNGNBankOfframpTransaction(transactionId);
                }
                if (transactionType === 'offramp-honeycoin-refund') {
                    return await HoneyCoinService.getHoneyCoinOfframpTransaction(transactionId);
                }
                if (transactionType === 'onramp-payout') {
                    return await FiatRampService.getOnrampTransaction(transactionId);
                }
                if (transactionType === 'ngn-airtime-data-refund') {
                    return await SafeHavenService.getVasPaymentSettlementById(transactionId);
                }
                throw new Error(`Invalid transaction type: ${transactionType}`);
            })();

            if (!transaction) {
                throw Error(`Transaction with ID ${transactionId} not found`);
            }

            const canPayout = (() => {
                if (
                    transactionType === 'offramp-refund' ||
                    transactionType === 'offramp-ngn-bank-refund' ||
                    transactionType === 'offramp-honeycoin-refund' ||
                    transactionType === 'ngn-airtime-data-refund'
                ) {
                    return transaction.status === 'failed';
                }
                if (transactionType === 'onramp-payout') {
                    return transaction.status === 'complete';
                }
                return false;
            })();

            if (!canPayout) {
                throw new Error(`Payout not available for transaction`);
            }

            let transactionAmount = transaction.usdAmount;

            if (
                (
                    transactionType === 'offramp-refund' ||
                    transactionType === 'offramp-ngn-bank-refund' ||
                    transactionType === 'offramp-honeycoin-refund' ||
                    transactionType === 'ngn-airtime-data-refund'
                ) &&
                'transactionHash' in transaction
            ) {
                const offrampRequest = await dbClient.offramp_awaiting_crypto_debit
                    .filter({
                        cryptoTransactionId: transaction.transactionHash,
                    })
                    .getFirst();

                if (!offrampRequest) {
                    throw new Error('Offramp request not found');
                }
                transactionAmount = offrampRequest.tokenAmountToDebit;
            }

            const assetConfig = azzaWalletManager.searchAssets({
                tokenName: transaction.tokenSymbol!,
                network: transaction.blockchainNetwork!,
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

            const cryptoPayoutParams: CryptoPayoutParams = {
                amount: transactionAmount!,
                userWalletAddress: destinationWalletAddress,
                targetTransactionHash: transaction.sequenceId,
                assetId: assetConfig.listItemId,
            };

            try {
                return await processCryptoPayout(cryptoPayoutParams, transactionType);
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
