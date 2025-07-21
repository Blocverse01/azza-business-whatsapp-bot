import { getMasterWalletClient } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import BlockradarMasterWalletWebhookService from '@/app/Blockradar/BlockradarMasterWalletWebhookService';
import { getChainCashbackConfig } from '@/app/campaigns/cashbacks/config';
import {
    isCashBackEnabledChain,
    sendDepositMessageWithCashbackBanner,
} from '@/app/campaigns/cashbacks/utils';
import { getCryptoPayoutRecord, updateCryptoPayoutRecord } from '@/app/crypto-payouts-v2/utils';
import { ProcessorId } from '@/app/FiatRamp/config';
import { OnrampTransactionRecord, transactionStatusSchema } from '@/app/FiatRamp/fiatRampSchema';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { addOfframpRequestToQueue } from '@/app/FiatRamp/queue-helpers';
import { sendTechnicalIssueAlert } from '@/app/support/whatsapp';
import { addBlockradarMasterWalletTokenSwapJobToQueue } from '@/app/swap/queue-utils';
import SwapService from '@/app/swap/service';
import { addFeeCollectionJobToQueue } from '@/app/transaction-fees/background-processing';
import { getTransactionFeeLogById } from '@/app/transaction-fees/utils';
import { addP2pAgentTransactionTrackerJobToQueue } from '@/app/User/P2pAgent/queue-utils';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { manageAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import { OfframpQueueFlowSchemaV2 } from '@/background-processing/schema';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import env from '@/constants/env';
import {
    CASHBACK_REFERENCE_PREFIX,
    CRYPTO_PAYOUT_REFERENCE_PREFIX,
    FEE_COLLECTION_REFERENCE_PREFIX,
    OFFRAMP,
    OFFRAMP_WITHDRAW_REFERENCE_PREFIX,
    PIZZA_CAMPAIGN_PAYMENT_SUFFIX,
    WITHDRAWAL_REFERENCE_PREFIX,
} from '@/constants/strings';
import { dbClient } from '@/db/dbClient';
import logger from '@/resources/logger';
import { generateReceivedTokenMessage } from '@/resources/utils/bot-message-utils';
import { identifyPaymentProvider } from '@/resources/utils/payment-provider-identifier.';
import { getTransactionExplorerUrl } from '@/resources/web3/core/explorerUrls';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';

const blockradarWebhookService = new BlockradarMasterWalletWebhookService({
    // Todo: Move handler implementation to appropriate service
    handleDepositSuccess: async (data, network) => {
        const userId = data.data.metadata?.userId as string;
        const blockradarAsset = data.data.asset;
        const platformAssetConfig = azzaWalletManager.searchAssets({
            tokenName: blockradarAsset.symbol,
            network,
        })[0];
        const amount = data.data.amount;
        const senderAddress = data.data.senderAddress;
        const recipientAddress = data.data.recipientAddress;
        const transactionHash = data.data.hash;

        if (!userId || !platformAssetConfig) {
            if (!data.data.address.name?.toLowerCase().includes('offramp'))
                await logger.debug(`Invalid deposit success data: ${transactionHash}`, {
                    data,
                    userId,
                    platformAssetConfig,
                });
            return;
        }

        const userWalletConfig =
            await userServiceV2.getUserBlockradarWalletByAddress(recipientAddress);

        if (!userWalletConfig) {
            return;
        }

        const [newBalance] = await Promise.all([
            azzaWalletManager.getAssetBalance({
                userId: userWalletConfig.user?.id!,
                assetId: platformAssetConfig.listItemId,
            }),
        ]);

        const assetConfig = newBalance.asset;

        const message = generateReceivedTokenMessage({
            tokenAmount: amount,
            assetName: assetConfig.tokenName,
            assetNetwork: assetConfig.network,
            senderAddress: senderAddress,
            transactionHash: transactionHash,
            explorerUrl: getTransactionExplorerUrl(transactionHash, assetConfig.network),
            newTokenBalance: newBalance.balance.toString(),
        });

        const userPhoneNumber = userWalletConfig?.user?.primaryWhatsappPhoneNumber!;

        try {
            const walletClient = getMasterWalletClient(network);
            const blockradarWithdrawTransaction = await walletClient.getTransactionByHash(
                transactionHash,
                'WITHDRAW'
            );
            if (blockradarWithdrawTransaction) {
                const reference = blockradarWithdrawTransaction.reference;

                if (
                    reference?.startsWith(CASHBACK_REFERENCE_PREFIX) &&
                    isCashBackEnabledChain(network)
                ) {
                    const cashbackConfig = getChainCashbackConfig(network);
                    await sendDepositMessageWithCashbackBanner(
                        message,
                        {
                            userPhoneNumber,
                            businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        },
                        cashbackConfig.campaignBannerMedia
                    );
                    return;
                }
            }
        } catch (error) {
            console.log(error);
        }

        const assetInteractiveMessage = MessageGenerators.generateInteractiveListMessage({
            recipient: userPhoneNumber,
            bodyText: message,
            headerText: ``,
            actionButtonText: 'Manage Asset',
            listItems: manageAssetActions.map((assetAction) => ({
                id: `${assetAction.action}:${assetConfig.listItemId}`,
                title: assetAction.text,
                description: assetAction.description,
            })),
        });

        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            assetInteractiveMessage
        );
    },
    handleWithdrawalSuccess: async (data, _) => {
        const metadata = data.data.metadata;
        const reference = data.data.reference;

        const reason = metadata?.reason;

        if (reason === SwapService.SWAP_WITHDRAWAL_TX_REASON && data.data.hash) {
            await addBlockradarMasterWalletTokenSwapJobToQueue(reference, {
                swapDebitReferenceId: reference,
                swapDebitTransactionHash: data.data.hash,
                whatsappParams: {
                    businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                },
            });

            return;
        }

        if (reason === OFFRAMP) {
            const pendingOfframpId = reference
                .split(OFFRAMP_WITHDRAW_REFERENCE_PREFIX)[1]
                .replace(PIZZA_CAMPAIGN_PAYMENT_SUFFIX, '');
            const pendingOfframpRequest =
                await dbClient.offramp_awaiting_crypto_debit.read(pendingOfframpId);

            if (!pendingOfframpRequest) {
                throw new Error('Pending request not found!');
            }

            const assetConfig = getAssetConfigOrThrow(pendingOfframpRequest.assetId!);
            const user = await userServiceV2.getUserById(pendingOfframpRequest.ownerId!);

            if (!user) throw new Error('Invalid transaction owner ID');

            void WhatsAppBotService.sendWhatsappMessage(
                env.WA_PHONE_NUMBER_ID,
                MessageGenerators.generateTextMessage(
                    user.primaryWhatsappPhoneNumber,
                    '✅ Crypto debit transaction confirmed!'
                )
            );

            await addOfframpRequestToQueue(
                OfframpQueueFlowSchemaV2.parse({
                    userId: pendingOfframpRequest.ownerId!,
                    conversionRate: pendingOfframpRequest.conversionRate,
                    localAmount: pendingOfframpRequest.localAmount!,
                    hotWalletAddress: pendingOfframpRequest.hotWalletAddress!,
                    transactionFeeUsd: pendingOfframpRequest.transactionFeeUsd!,
                    beneficiaryId: pendingOfframpRequest.beneficiaryId!,
                    ngnVasSettlementId: pendingOfframpRequest.ngnVasSettlementId ?? undefined,
                    usdAmount: pendingOfframpRequest.usdAmount!,
                    platformFeePercentage: pendingOfframpRequest.platformFeePercentage,
                    userWalletAddress: pendingOfframpRequest.fromWalletAddress!,
                    tokenAddress: assetConfig.tokenAddress,
                    tokenName: assetConfig.tokenName,
                    chainName: assetConfig.network.toUpperCase(),
                    txHash: data.data.hash,
                    tokenAmountDebited: pendingOfframpRequest.tokenAmountToDebit,
                    isAgentTransaction: pendingOfframpRequest.isAgentTransaction,
                    whatsappParams: {
                        businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        userPhoneNumber: user.primaryWhatsappPhoneNumber,
                    },
                })
            );

            await pendingOfframpRequest.update({
                cryptoTransactionId: data.data.hash,
                cryptoTransactionStatus: 'SUCCESS',
            });
            return;
        }

        if (reference.startsWith(WITHDRAWAL_REFERENCE_PREFIX) && !data.data.metadata?.isFree) {
            await addFeeCollectionJobToQueue(reference);
            return;
        }

        if (reference.startsWith(FEE_COLLECTION_REFERENCE_PREFIX)) {
            const transactionFeeLog = await getTransactionFeeLogById(reference);
            if (!transactionFeeLog) {
                return;
            }

            await transactionFeeLog.update({
                status: 'collected',
                collectionTxHash: data.data.hash,
            });
            return;
        }

        if (reference.startsWith(CRYPTO_PAYOUT_REFERENCE_PREFIX)) {
            const cryptoPayoutRecord = await getCryptoPayoutRecord(reference);

            if (!cryptoPayoutRecord) return;

            const isUpdated = await updateCryptoPayoutRecord(reference, {
                payoutTransactionHash: data.data.hash,
                status: 'complete',
            });

            if (isUpdated) {
                const providerName = identifyPaymentProvider(
                    cryptoPayoutRecord.triggerTransactionId
                ) as ProcessorId;

                let isAgentTransaction = false;
                let onRampTxn: OnrampTransactionRecord | null = null;

                if (providerName === 'yellowcard') {
                    const txn = await FiatRampService.getOnrampTransaction(
                        cryptoPayoutRecord.triggerTransactionId
                    );
                    isAgentTransaction = !!txn.isAgentTransaction;
                    onRampTxn = txn;
                }

                // Add agent transaction tracker job for reporting
                if (isAgentTransaction && onRampTxn) {
                    await addP2pAgentTransactionTrackerJobToQueue({
                        localAmount: onRampTxn.localAmount,
                        usdAmount: onRampTxn.usdAmount,
                        processingStatus: transactionStatusSchema.parse('complete'),
                        ownerId: onRampTxn.ownerId,
                        blockchainNetwork: onRampTxn.blockchainNetwork.toUpperCase(),
                        tokenSymbol: onRampTxn.tokenSymbol.toUpperCase(),
                        transactionType: 'onramp',
                        sequenceId: onRampTxn.sequenceId,
                        providerName: providerName,
                        localCurrencySymbol: onRampTxn.localCurrencySymbol,
                        country: onRampTxn.collectionCountry,
                        transactionFeeUsd: onRampTxn.transactionFeeUsd,
                    });
                }
            }
        }
    },
    handleWithdrawalFailed: async (data, network) => {
        const metadata = data.data.metadata;
        const reference = data.data.reference;

        const reason = metadata?.reason;

        if (reason === SwapService.SWAP_WITHDRAWAL_TX_REASON) {
            const pendingSwapRequest =
                await SwapService.getSwapTransactionByExternalReference(reference);

            if (!pendingSwapRequest) {
                return;
            }

            const user = await userServiceV2.getUserById(pendingSwapRequest.user?.id!);

            if (!user) throw new Error('Invalid swap user ID');

            const liveTransactionData = await azzaWalletManager.getTransactionByHash(
                data.data.hash,
                network
            );

            if (liveTransactionData.status === 'SUCCESS') {
                const technicalSupportMessage = `Swap debit transaction was successful, but a withdraw.failed webhook was sent.\n\nTransaction details:\nTransaction ID: ${data.data.id}\nBlockchain: ${network}\nHash: ${data.data.hash}\nReference: ${reference}`;

                await sendTechnicalIssueAlert(technicalSupportMessage, env.WA_PHONE_NUMBER_ID);

                return;
            }

            await WhatsAppBotService.sendWhatsappMessage(
                env.WA_PHONE_NUMBER_ID,
                MessageGenerators.generateTextMessage(
                    user.primaryWhatsappPhoneNumber,
                    '❌ Your swap transaction failed, please try again.\n\nIf you were debited, please contact reach out for assistance using the /support command.'
                )
            );

            await pendingSwapRequest.update({
                transactionHash: `debit_${data.data.hash}`,
                status: 'failed',
            });

            return;
        }

        if (reason === OFFRAMP) {
            const pendingOfframpId = reference.split(OFFRAMP_WITHDRAW_REFERENCE_PREFIX)[1];
            const pendingOfframpRequest =
                await dbClient.offramp_awaiting_crypto_debit.read(pendingOfframpId);

            if (!pendingOfframpRequest) {
                throw new Error('Pending request not found!');
            }

            const user = await userServiceV2.getUserById(pendingOfframpRequest.ownerId!);

            if (!user) throw new Error('Invalid transaction owner ID');

            const liveTransactionData = await azzaWalletManager.getTransactionByHash(
                data.data.hash,
                network
            );

            if (liveTransactionData.id.toLowerCase() !== data.data.id.toLowerCase()) {
                const technicalSupportMessage = `Critical issue with mismatching transaction details (Webhook Tx !== Retrieved Tx).\n\nWebhook Transaction details:\nTransaction ID: ${data.data.id}\nBlockchain: ${network}\nHash: ${data.data.hash}\n\nRetrieved Transaction details:\nTransaction ID: ${liveTransactionData.id}\nBlockchain: ${network}\nHash: ${liveTransactionData.hash}\n\nPending Offramp ID: ${pendingOfframpId}`;

                await sendTechnicalIssueAlert(technicalSupportMessage, env.WA_PHONE_NUMBER_ID);

                return;
            }

            if (liveTransactionData.status === 'SUCCESS') {
                const technicalSupportMessage = `Offramp debit transaction was successful, but a withdraw.failed webhook was sent.\n\nTransaction details:\nTransaction ID: ${data.data.id}\nBlockchain: ${network}\nHash: ${data.data.hash}\nPending Offramp ID: ${pendingOfframpId}`;

                await sendTechnicalIssueAlert(technicalSupportMessage, env.WA_PHONE_NUMBER_ID);

                return;
            }

            await WhatsAppBotService.sendWhatsappMessage(
                env.WA_PHONE_NUMBER_ID,
                MessageGenerators.generateTextMessage(
                    user.primaryWhatsappPhoneNumber,
                    '❌ Crypto debit transaction failed!'
                )
            );

            await pendingOfframpRequest.update({
                cryptoTransactionId: data.data.id,
                cryptoTransactionStatus: liveTransactionData.status,
            });

            return;
        }

        if (reference.startsWith(FEE_COLLECTION_REFERENCE_PREFIX)) {
            const transactionFeeLog = await getTransactionFeeLogById(reference);
            if (!transactionFeeLog) {
                return;
            }

            await transactionFeeLog.update({
                status: 'collection_failed',
                collectionTxHash: data.data.hash,
            });
            return;
        }

        if (reference.startsWith(CRYPTO_PAYOUT_REFERENCE_PREFIX)) {
            const cryptoPayoutRecord = await getCryptoPayoutRecord(reference);
            if (!cryptoPayoutRecord) return;

            await updateCryptoPayoutRecord(reference, {
                payoutTransactionHash: data.data.hash,
                status: 'failed',
            });
        }
    },
    handleSwapSuccess: async (data, _network) => {
        const reference = data.data.reference;

        const swapTransactionRecord =
            await SwapService.getSwapTransactionByExternalReference(reference);

        if (!swapTransactionRecord) return;

        const userPhoneNumber = await userServiceV2.getUserPhoneNumber(
            swapTransactionRecord.user?.id!
        );

        try {
            await swapTransactionRecord.update({
                status: 'complete',
                transactionHash: `swap_${data.data.hash}`,
            });
        } catch (e) {}

        if (reference.startsWith(SwapService.EXTERNAL_REFERENCE_PREFIX)) {
            await addFeeCollectionJobToQueue(reference);
        }

        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            MessageGenerators.generateTextMessage(
                userPhoneNumber,
                `✅ Your swap transaction has been completed successfully. Expect your new crypto asset in 1 - 5 minutes 🩵`
            )
        );
    },
    handleSwapFailed: async (data, _network) => {
        const reference = data.data.reference;

        const swapTransactionRecord =
            await SwapService.getSwapTransactionByExternalReference(reference);

        if (!swapTransactionRecord) return;

        const userPhoneNumber = await userServiceV2.getUserPhoneNumber(
            swapTransactionRecord.user?.id!
        );

        try {
            await swapTransactionRecord.update({
                status: 'failed',
                transactionHash: `swap_${data.data.hash}`,
            });
        } catch (e) {}
        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            MessageGenerators.generateTextMessage(
                userPhoneNumber,
                `❌ Your swap transaction failed, please try again.\n\nIf you were debited, please contact reach out for assistance using the /support command.`
            )
        );
    },
});

export default blockradarWebhookService;
