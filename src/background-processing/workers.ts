import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import {
    sendTransferAssetTransaction,
    SendTransferTransactionResponse,
    SendTransferTransactionResult,
} from '@/app/azza/lib/azza.lib.transaction';
import { changeTransactionPin, setTransactionPin } from '@/app/azza/lib/azza.lib.user-security';
import {
    waitForTransactionReceipt,
    waitForTransactionReceiptV2,
} from '@/app/azza/lib/azza.lib.wait-for-transaction-receipt';
import { CryptoPayoutOrderStatus } from '@/app/CryptoPayout/cryptoPayoutSchema';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import {
    createWhatsappMessagingWorker,
    createWhatsppBroadcastWorker,
} from '@/app/WhatsAppBot/messagingQueueHelpers';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { CryptoDebitWorkerError } from '@/background-processing/errors';
import { queues } from '@/background-processing/queues';
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
} from '@/background-processing/types';
import env from '@/constants/env';
import { HttpException } from '@/resources/exceptions/HttpException';
import { logServiceError, parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
    decryptWithAES,
} from '@/resources/utils/encryption';
import { TokenNames } from '@/resources/web3/tokens';
import azzaWalletManager from '@/runtime/wallet';
import { Worker } from 'bullmq';

///////////////////////
// Worker Instances
///////////////////////
const fiatPayoutWorker = new Worker<OfframpQueueFlowParams, FiatPayoutQueueResult, 'offramp'>(
    QueueNames.fiatPayout,
    async (job) => {
        const userId = convertBase64ToAsciiString(job.data.userId);
        const userPhoneNumber = convertBase64ToAsciiString(job.data.whatsappParams.userPhoneNumber);
        const businessPhoneNumberId = job.data.whatsappParams.businessPhoneNumberId;

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
                businessPhoneNumberId,
                MessageGenerators.generateTextMessage(userPhoneNumber, userMessage)
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

            const supportedChain = azzaWalletManager
                .getSupportedNetworks()
                .find((network) => network.toLowerCase() === job.data.chainName.toLowerCase());

            if (txHash && supportedChain) {
                if (
                    job.data.tokenName === TokenNames.USDC ||
                    job.data.tokenName === TokenNames.USDT
                ) {
                    const totalAmount = job.data.usdAmount + job.data.transactionFeeUsd;
                    await CryptoPayoutService.createOfframpCryptoRefundOrder({
                        network: job.data.chainName as SupportedChain,
                        tokenSymbol: job.data.tokenName,
                        triggerTransactionId: txHash,
                        amount: totalAmount,
                        destinationWalletAddress: job.data.userWalletAddress,
                        payoutType: 'offramp-refund',
                    });

                    await WhatsAppBotService.sendWhatsappMessage(
                        businessPhoneNumberId,
                        MessageGenerators.generateTextMessage(
                            userPhoneNumber,
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
    Required<TransferAssetTransactionDetails> | CryptoDebitQueueInput,
    CryptoDebitQueueResult,
    'send-crypto' | 'offramp-debit' | 'user-funds-migration'
>(
    QueueNames.cryptoDebit,
    async (job) => {
        const transactionData = 'transferDetails' in job.data ? job.data.transferDetails : job.data;
        const whatsappParams = 'whatsappParams' in job.data ? job.data.whatsappParams : null;

        const requirePin = job.name !== 'user-funds-migration';
        const walletManager = job.name === 'user-funds-migration' ? 'legacy' : ('new' as const);

        const result = await sendTransferAssetTransaction(
            {
                ...transactionData,
                userId: convertBase64ToAsciiString(transactionData.userId),
                transactionPin: transactionData.transactionPin
                    ? decryptWithAES(
                          transactionData.transactionPin,
                          env.SECURITY_QUESTIONS_MASK_KEY,
                          env.SECURITY_QUESTIONS_MASK_IV
                      )
                    : '',
            },
            requirePin,
            walletManager
        );

        const [sendCryptoTxResponse, txError] = result;

        if (txError !== null) {
            throw new CryptoDebitWorkerError(txError.message, txError.data);
        }

        const refinedSendCryptoTxResponse = {
            ...sendCryptoTxResponse,
            userId: convertAsciiStringToBase64(sendCryptoTxResponse.userId),
        } satisfies SendTransferTransactionResponse;

        if (job.name === 'user-funds-migration' && refinedSendCryptoTxResponse) {
            await queues.cryptoDebitConfirmation.add(
                'user-funds-migration-confirmation',
                refinedSendCryptoTxResponse
            );
        }

        return {
            transactionResponse: refinedSendCryptoTxResponse,
            whatsappParams: whatsappParams,
        };
    },
    {
        connection: connectionConfig,
    }
);

const cryptoDebitConfirmationWorker = new Worker<
    | SendTransferTransactionResponse
    | CryptoDebitConfirmationQueueInput
    | CryptoPayoutDebitConfirmationInput,
    CryptoDebitConfirmationQueueResult,
    | 'send-crypto-confirmation'
    | 'offramp-debit-confirmation'
    | 'user-funds-migration-confirmation'
    | 'crypto-payout-confirmation'
>(
    QueueNames.cryptoDebitConfirmation,
    async (job) => {
        if ('orderId' in job.data) {
            if (job.name === 'crypto-payout-confirmation') {
                const transactionReceipt = await waitForTransactionReceiptV2({
                    transactionId: job.data.transactionId,
                    asset: job.data.asset,
                    walletManager: 'new',
                });

                const newStatus =
                    transactionReceipt.status === 'success'
                        ? CryptoPayoutOrderStatus.COMPLETE
                        : CryptoPayoutOrderStatus.FAILED;

                await CryptoPayoutService.updateProcessedCryptPayoutOrder(job.data.orderId, {
                    status: newStatus,
                    payoutTransactionHash: transactionReceipt.transactionHash,
                });

                return {
                    status: transactionReceipt.status,
                    transactionHash: transactionReceipt.transactionHash,
                };
            }

            throw new Error(`Invalid job data for ${job.name}`);
        }

        if (job.name === 'offramp-debit-confirmation') {
            const childrenValues = await job.getChildrenValues<CryptoDebitQueueResult>();

            const targetChildValueKey = Object.keys(childrenValues).find((key) =>
                key.includes(QueueNames.cryptoDebit)
            );

            const cryptoDebitResult = targetChildValueKey
                ? (childrenValues[targetChildValueKey] as CryptoDebitQueueResult)
                : null;

            if (cryptoDebitResult === null) {
                return {
                    status: 'failed',
                    transactionHash: null,
                };
            }

            if (cryptoDebitResult.whatsappParams) {
                const message = MessageGenerators.generateTextMessage(
                    cryptoDebitResult.whatsappParams.userPhoneNumber,
                    `🚀 Confirming crypto debit transaction...`
                );

                void WhatsAppBotService.sendWhatsappMessage(
                    cryptoDebitResult.whatsappParams.businessPhoneNumberId,
                    message
                );
            }

            const transactionReceipt = await waitForTransactionReceipt({
                ...cryptoDebitResult.transactionResponse,
                userId: convertBase64ToAsciiString(cryptoDebitResult.transactionResponse.userId),
            });

            if (cryptoDebitResult.whatsappParams) {
                const messageText =
                    transactionReceipt.status === 'success'
                        ? `✅ Crypto debit transaction confirmed!`
                        : `❌ Crypto debit transaction failed!\n\nWe could not debit ${cryptoDebitResult.transactionResponse.transactionAmount} ${cryptoDebitResult.transactionResponse.asset.tokenName} on ${cryptoDebitResult.transactionResponse.asset.network} from your wallet.\n\n_Please try again later or contact support for assistance._`;

                const messageObject = MessageGenerators.generateTextMessage(
                    cryptoDebitResult.whatsappParams.userPhoneNumber,
                    messageText
                );

                await WhatsAppBotService.sendWhatsappMessage(
                    cryptoDebitResult.whatsappParams.businessPhoneNumberId,
                    messageObject
                );
            }

            return {
                status: transactionReceipt.status,
                transactionHash: transactionReceipt.transactionHash,
            };
        }

        const transactionResponse =
            'transactionResponse' in job.data ? job.data.transactionResponse : job.data;
        const whatsappParams = 'whatsappParams' in job.data ? job.data.whatsappParams : null;

        const transactionReceipt = await waitForTransactionReceipt({
            ...transactionResponse,
            userId: convertBase64ToAsciiString(transactionResponse.userId),
        });

        if (job.name === 'send-crypto-confirmation' && whatsappParams) {
            const { transactionId, transactionAmount, destination, asset } = transactionResponse;
            const { businessPhoneNumberId, userPhoneNumber } = whatsappParams;

            const assetLabel = `${asset.tokenName} (${asset.network})`;

            const transactionHash = transactionReceipt.transactionHash;
            const transactionStatus = transactionReceipt.status;
            const explorerUrl = transactionReceipt.explorerUrl;

            if (transactionStatus === 'success' && transactionHash) {
                const message = MessageGenerators.generateInteractiveCtaUrlButtonMessage({
                    bodyText: `✅ Your Transaction with the following details has been completed:\n\n🔀 Transfer ${transactionAmount} ${assetLabel} to ${destination}${transactionId !== transactionHash ? `\n\n➡️ Request ID: ${transactionId}` : ''}\n\n➡️ Transaction Hash: ${transactionHash}`,
                    ctaText: 'View In Explorer',
                    ctaUrl: explorerUrl!,
                    recipient: userPhoneNumber,
                    headerText: 'Transaction Completed',
                    footerText: 'Thank you for using Azza!',
                });

                await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, message);
            }

            if (transactionStatus === 'failed') {
                const message = MessageGenerators.generateTextMessage(
                    userPhoneNumber,
                    `❌ Your Transaction with the following details has failed:\n\n🔀 Transfer ${transactionAmount} ${assetLabel} to ${destination}\n\n➡️ Request ID: ${transactionId}\n\nPlease try again later or contact support for assistance.`
                );

                await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, message);

                await logServiceError(
                    new HttpException(500, 'Transaction failed', {
                        transactionReceipt,
                        params: job.data,
                    }),
                    'Transaction failed:'
                );
            }
        }

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
        const businessPhoneNumberId = job.data.whatsappParams.businessPhoneNumberId;
        const userPhoneNumber = convertBase64ToAsciiString(job.data.whatsappParams.userPhoneNumber);

        switch (job.name) {
            case 'set-tx-pin':
                await WhatsAppBotService.sendWhatsappMessage(
                    businessPhoneNumberId,
                    MessageGenerators.generateTextMessage(
                        userPhoneNumber,
                        '🚀 Securing your account 🔐...'
                    )
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
                    businessPhoneNumberId,
                    MessageGenerators.generateTextMessage(
                        userPhoneNumber,
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
                userPhoneNumber,
                `✅ *Transaction PIN successfully updated!*\n\n🔒 _Keep it safe—your PIN is personal and should not be shared._\n\nHere's what you can do next on Azza:\n\n${actionsList}\n\n💬 Type *help* to ask the bot for guidance or try slash commands like */transfer*, */balance*, or */deposit* to get started!`
            );

            await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, message);

            return { status: 'success' };
        }

        return { status: 'failed' };
    },
    {
        connection: connectionConfig,
    }
);

createWhatsppBroadcastWorker();

// Start 10 whatsapp messaging workers
for (let i = 0; i < 10; i++) {
    createWhatsappMessagingWorker();
}

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
