import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import {
    sendTransferAssetTransaction,
    SendTransferTransactionResponse,
    SendTransferTransactionResult,
} from '@/app/azza/lib/azza.lib.transaction';
import { changeTransactionPin, setTransactionPin } from '@/app/azza/lib/azza.lib.user-security';
import { waitForTransactionReceipt } from '@/app/azza/lib/azza.lib.wait-for-transaction-receipt';
import { ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS } from '@/app/CryptoPayout/config';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { OfframpQueueFlowParams } from '@/background-processing/schema';
import {
    CryptoDebitConfirmationQueueResult,
    FiatPayoutQueueResult,
    QueueNames,
    UserTxPinSecurityQueueInput,
    UserTxPinSecurityQueueResult,
} from '@/background-processing/types';
import env from '@/constants/env';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import { convertBase64ToAsciiString, decryptWithAES } from '@/resources/utils/encryption';
import { TokenNames } from '@/resources/web3/tokens';
import { Worker } from 'bullmq';

///////////////////////
// Worker Instances
///////////////////////
const fiatPayoutWorker = new Worker<OfframpQueueFlowParams, FiatPayoutQueueResult, 'offramp'>(
    QueueNames.fiatPayout,
    async (job) => {
        const userId = convertBase64ToAsciiString(job.data.userId);

        const childrenValues = await job.getChildrenValues<
            SendTransferTransactionResult | CryptoDebitConfirmationQueueResult
        >();

        const cryptoDebitConfirmationChildValueKey = Object.keys(childrenValues).find((key) =>
            key.includes(QueueNames.cryptoDebitConfirmation)
        );

        const cryptoDebitConfirmation = cryptoDebitConfirmationChildValueKey
            ? (childrenValues[
                  cryptoDebitConfirmationChildValueKey
              ] as CryptoDebitConfirmationQueueResult)
            : { status: 'failed', transactionHash: null };

        const txHash = cryptoDebitConfirmation.transactionHash;

        if (cryptoDebitConfirmation.status !== 'success' || txHash === null) {
            const userMessage = `Debiting ${job.data.usdAmount} ${job.data.tokenName} from your wallet failed.\nTx Hash: ${cryptoDebitConfirmation.transactionHash}\nPlease reach out to support if you were debited.`;
            await WhatsAppBotService.sendWhatsappMessage(
                env.WA_PHONE_NUMBER_ID,
                MessageGenerators.generateTextMessage(userId, userMessage)
            );

            return {
                result: 'FAILED',
                error: `Crypto Debit Failed.\nTx Hash: ${cryptoDebitConfirmation.transactionHash}\nChain: ${job.data.chainName}`,
            };
        }

        try {
            const sequenceId = await FiatRampService.postOfframpTransaction({
                ...job.data,
                txHash: txHash,
                chainName: job.data.chainName.toUpperCase(),
                tokenName: job.data.tokenName.toUpperCase(),
                userId: userId,
            });

            return { sequenceId, result: 'SENT' };
        } catch (error) {
            const parsedError = parseUnknownError(error);

            if (
                txHash &&
                ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS.includes(job.data.chainName as SupportedChain)
            ) {
                if (
                    job.data.tokenName === TokenNames.USDC ||
                    job.data.tokenName === TokenNames.USDT
                ) {
                    await CryptoPayoutService.createOfframpCryptoRefundOrder({
                        network: job.data.chainName as SupportedChain,
                        tokenSymbol: job.data.tokenName,
                        triggerTransactionId: txHash,
                        ownerId: userId,
                        amount: job.data.usdAmount,
                        destinationWalletAddress: job.data.userWalletAddress,
                    });

                    await WhatsAppBotService.sendWhatsappMessage(
                        env.WA_PHONE_NUMBER_ID,
                        MessageGenerators.generateTextMessage(
                            userId,
                            `An error occurred while sending your transaction.\nYour ${job.data.tokenName} will be refunded to your wallet.`
                        )
                    );

                    return { result: 'REFUNDING_CRYPTO', error: parsedError.message };
                }
            }

            return { result: 'FAILED', error: parsedError.message };
        }
    },
    {
        connection: connectionConfig,
    }
);
const cryptoDebitWorker = new Worker<
    Required<TransferAssetTransactionDetails>,
    SendTransferTransactionResult,
    'send-crypto' | 'offramp-debit'
>(
    QueueNames.cryptoDebit,
    async (job) => {
        try {
            return await sendTransferAssetTransaction({
                ...job.data,
                userId: convertBase64ToAsciiString(job.data.userId),
                transactionPin: decryptWithAES(
                    job.data.transactionPin,
                    env.SECURITY_QUESTIONS_MASK_KEY,
                    env.SECURITY_QUESTIONS_MASK_IV
                ),
            });
        } catch (e) {
            const error = parseUnknownError(e);
            return [null, error];
        }
    },
    {
        connection: connectionConfig,
    }
);

const cryptoDebitConfirmationWorker = new Worker<
    SendTransferTransactionResponse,
    CryptoDebitConfirmationQueueResult,
    'send-crypto-confirmation' | 'offramp-debit-confirmation'
>(
    QueueNames.cryptoDebitConfirmation,
    async (job) => {
        const childrenValues = await job.getChildrenValues<SendTransferTransactionResult>();

        if (job.name === 'offramp-debit-confirmation') {
            const targetChildValueKey = Object.keys(childrenValues).find((key) =>
                key.includes(QueueNames.cryptoDebit)
            );
            const [cryptoDebitTx, txError] = targetChildValueKey
                ? (childrenValues[targetChildValueKey] as SendTransferTransactionResult)
                : [null, { message: 'No crypto debit transaction' }];

            if (txError !== null || cryptoDebitTx === null) {
                return {
                    status: 'failed',
                    transactionHash: null,
                };
            }

            const transactionReceipt = await waitForTransactionReceipt({
                ...cryptoDebitTx,
                userId: convertBase64ToAsciiString(cryptoDebitTx.userId),
            });

            return {
                status: transactionReceipt.status,
                transactionHash: transactionReceipt.transactionHash,
            };
        }

        const transactionReceipt = await waitForTransactionReceipt({
            ...job.data,
            userId: convertBase64ToAsciiString(job.data.userId),
        });

        return {
            status: transactionReceipt.status,
            transactionHash: transactionReceipt.transactionHash,
        };
    },
    {
        connection: connectionConfig,
    }
);

const userTxPinSecurityWorker = new Worker<
    UserTxPinSecurityQueueInput,
    UserTxPinSecurityQueueResult,
    'set-tx-pin' | 'change-tx-pin'
>(
    QueueNames.userTxPinSecurity,
    async (job) => {
        let isSuccessful = false;

        const userId = convertBase64ToAsciiString(job.data.userId);

        switch (job.name) {
            case 'set-tx-pin':
                await WhatsAppBotService.sendWhatsappMessage(
                    env.WA_PHONE_NUMBER_ID,
                    MessageGenerators.generateTextMessage(userId, '🚀 Securing your account 🔐...')
                );
                if ('encryptedSecurityQuestions' in job.data) {
                    isSuccessful = (
                        await setTransactionPin({
                            newPinHash: job.data.newPinHash,
                            userId: userId,
                            encryptedSecurityQuestions: job.data.encryptedSecurityQuestions,
                        })
                    ).pinSet;

                    break;
                }
                throw new Error(`Invalid job data for ${job.name}`);

            case 'change-tx-pin':
                await WhatsAppBotService.sendWhatsappMessage(
                    env.WA_PHONE_NUMBER_ID,
                    MessageGenerators.generateTextMessage(
                        userId,
                        '🚀 Updating your Transaction PIN 🔐...'
                    )
                );
                isSuccessful = (
                    await changeTransactionPin({
                        newPinHash: job.data.newPinHash,
                        userId: userId,
                    })
                ).pinChanged;

                break;
        }

        if (isSuccessful) {
            const possibleActions = [
                { emoji: '🔁', description: 'Transfer assets to contacts and wallet addresses' },
                { emoji: '📈', description: 'Check your wallet balance' },
                { emoji: '💰', description: 'Deposit crypto into your wallet' },
            ];

            const actionsList = possibleActions
                .map((action) => `• ${action.emoji} ${action.description}`)
                .join('\n');

            const message = MessageGenerators.generateTextMessage(
                userId,
                `✅ *Transaction PIN successfully updated!*\n\n🔒 _Keep it safe—your PIN is personal and should not be shared._\n\nHere's what you can do next on Azza:\n\n${actionsList}\n\n💬 Type *help* to ask the bot for guidance or try slash commands like */transfer*, */balance*, or */deposit* to get started!`
            );

            await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

            return { status: 'success' };
        }

        return { status: 'failed' };
    },
    {
        connection: connectionConfig,
    }
);

///////////////////////
// Worker Event Handlers
///////////////////////

// Fiat Payout Worker
fiatPayoutWorker.on('completed', async (job) => {
    console.log('Fiat Payout Worker completed', job.returnvalue);
});
fiatPayoutWorker.on('failed', async (job, error) => {
    console.log(`Fiat Payout Worker failed`, error);
});

// Crypto Debit Worker
cryptoDebitWorker.on('completed', async (job) => {
    console.log('Crypto Debit Worker completed', job.returnvalue);
});
cryptoDebitWorker.on('failed', async (job, error) => {
    console.log(`Crypto Debit Worker failed`, error);
});

// Crypto Debit Confirmation Worker
cryptoDebitConfirmationWorker.on('completed', async (job) => {
    console.log('Crypto Debit Confirmation Worker completed', job.returnvalue);
});
cryptoDebitConfirmationWorker.on('failed', async (job, error) => {
    console.log(`Crypto Debit Confirmation Worker failed`, error);
});

// User Tx Pin Security Worker
userTxPinSecurityWorker.on('completed', async (job) => {
    console.log('User Tx Pin Security Worker completed', job.returnvalue);
});
userTxPinSecurityWorker.on('failed', async (job, error) => {
    console.log(`User Tx Pin Security Worker failed`, error);
});
