import {
    AssetTransferRecipientType,
    TransferAssetTransactionDetails,
} from '@/app/azza/azza.schema';
import {
    sendTransferAssetTransaction,
    SendTransferTransactionResponse,
    SendTransferTransactionResult,
} from '@/app/azza/lib/azza.lib.transaction';
import { changeTransactionPin, setTransactionPin } from '@/app/azza/lib/azza.lib.user-security';
import { waitForTransactionReceipt } from '@/app/azza/lib/azza.lib.wait-for-transaction-receipt';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import UserService from '@/app/User/UserService';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { CryptoDebitWorkerError } from '@/background-processing/errors';
import { queues } from '@/background-processing/queues';
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
import { ENABLED_ASSETS } from '@/config/whatsAppBot';
import env from '@/constants/env';
import { UserRecord } from '@/db/xata';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
    decryptWithAES,
} from '@/resources/utils/encryption';
import { TokenNames } from '@/resources/web3/tokens';
import userServiceV2 from '@/runtime/user';
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
    Required<TransferAssetTransactionDetails>,
    SendTransferTransactionResult,
    'send-crypto' | 'offramp-debit' | 'user-funds-migration'
>(
    QueueNames.cryptoDebit,
    async (job) => {
        const result = await sendTransferAssetTransaction(
            {
                ...job.data,
                userId: convertBase64ToAsciiString(job.data.userId),
                transactionPin: job.data.transactionPin
                    ? decryptWithAES(
                          job.data.transactionPin,
                          env.SECURITY_QUESTIONS_MASK_KEY,
                          env.SECURITY_QUESTIONS_MASK_IV
                      )
                    : '',
            },
            job.name !== 'user-funds-migration',
            job.name === 'user-funds-migration' ? 'legacy' : 'new'
        );

        const [sendCryptoTxResponse, txError] = result;

        if (job.name === 'user-funds-migration' && sendCryptoTxResponse) {
            await queues.cryptoDebitConfirmation.add('user-funds-migration-confirmation', {
                ...sendCryptoTxResponse,
                userId: convertAsciiStringToBase64(sendCryptoTxResponse.userId),
            });
        }

        if (txError !== null) {
            throw new CryptoDebitWorkerError(txError.message, txError.data);
        }

        const sendCryptoTxResponseWithMaskedUserId = {
            ...sendCryptoTxResponse,
            userId: convertAsciiStringToBase64(sendCryptoTxResponse.userId),
        } as const;

        return [sendCryptoTxResponseWithMaskedUserId, txError];
    },
    {
        connection: connectionConfig,
    }
);

const cryptoDebitConfirmationWorker = new Worker<
    SendTransferTransactionResponse,
    CryptoDebitConfirmationQueueResult,
    'send-crypto-confirmation' | 'offramp-debit-confirmation' | 'user-funds-migration-confirmation'
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

const walletMigrationWorker = new Worker<
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult
>(
    QueueNames.walletMigration,
    async (job) => {
        const oldUserId = job.data.oldUserId
            ? convertBase64ToAsciiString(job.data.oldUserId)
            : undefined;
        const userPhoneNumber = convertBase64ToAsciiString(job.data.userPhoneNumber);
        const businessPhoneNumberId = convertBase64ToAsciiString(job.data.businessPhoneNumberId);
        let oldUser: UserRecord | null = null;

        if (oldUserId) {
            oldUser = await UserService.getUserByPhoneNumber(oldUserId);
        }

        const newUser =
            (await userServiceV2.getWhatsappUserByPhoneNumber(userPhoneNumber)) ??
            (await userServiceV2.createWhatsappUser(
                userPhoneNumber,
                oldUser
                    ? {
                          transactionPinHash: oldUser.transactionPinHash,
                          securityQuestionsSetup: oldUser.securityQuestionsSetup,
                          firstName: oldUser.firstName,
                          lastName: oldUser.lastName,
                          kycStatus: oldUser.kycStatus,
                          kycDateOfBirth: oldUser.kycDateOfBirth,
                          kycIdType: oldUser.kycIdType,
                          kycDocumentNumber: oldUser.kycDocumentNumber,
                          additionalKycIdType: oldUser.additionalKycIdType ?? null,
                          additionalKycIdNumber: oldUser.additionalKycIdNumber,
                          country: oldUser.country,
                      }
                    : undefined
            ));

        if (oldUser) {
            await UserService.updateMigratedAt(oldUser, new Date());
        }

        const newUserId = newUser.id;

        const newWallets = await azzaWalletManager.createUserWallets({
            userId: newUserId,
            networks: azzaWalletManager.getSupportedNetworks(),
            shouldMapEvmAddresses: true,
        });

        const existingWalletConfig = await userServiceV2.getUserBlockradarWallets(newUserId);

        if (!existingWalletConfig) {
            await userServiceV2.createUserBlockradarWalletConfig(
                newUserId,
                newWallets.map((wallet) => ({
                    blockchainNetwork: wallet.blockchainNetwork,
                    addressId: wallet.id,
                    address: wallet.address,
                }))
            );

            if (oldUserId) {
                await WhatsAppBotService.sendWhatsappMessage(
                    businessPhoneNumberId,
                    MessageGenerators.generateTextMessage(
                        userPhoneNumber,
                        '🚀 Your wallets have been successfully migrated. You can now continue using Azza!'
                    )
                );
            }
        }

        if (oldUserId) {
            const supportedAssetIds = ENABLED_ASSETS.map((asset) => asset.listItemId);
            const promises = supportedAssetIds.map((assetId) =>
                UserService.getUserAssetInfo(oldUserId, assetId)
            );
            const userAssets = await Promise.all(promises);

            const addCryptoDebitPromises = userAssets.map((asset) => {
                const targetWallet = newWallets.find(
                    (wallet) => wallet.blockchainNetwork === asset.assetNetwork
                )?.address;

                if (asset && asset.tokenBalance > 0 && targetWallet) {
                    return queues.cryptoDebit.add('user-funds-migration', {
                        userId: convertAsciiStringToBase64(oldUserId),
                        transactionType: 'SEND',
                        assetId: asset.listItemId,
                        amount: asset.tokenBalance,
                        recipient: targetWallet,
                        recipientType: AssetTransferRecipientType.WALLET_ADDRESS,
                        transactionFee: 0,
                        transactionPin: '',
                    });
                }
            });

            await Promise.all(addCryptoDebitPromises);
        }

        return {
            newUserId,
            walletIds: newWallets.map((wallet) => wallet.id),
        };
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

// Wallet Migration Worker
walletMigrationWorker.on('completed', async (job) => {
    console.log('Wallet Migration Worker completed', job.returnvalue);
});
walletMigrationWorker.on('failed', async (job, error) => {
    console.log(`Wallet Migration Worker failed`, error);
});
