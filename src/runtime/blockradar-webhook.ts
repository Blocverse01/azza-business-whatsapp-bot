import BlockradarMasterWalletWebhookService from '@/app/Blockradar/BlockradarMasterWalletWebhookService';
import { addOfframpRequestToQueue } from '@/app/FiatRamp/queue-helpers';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { manageAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import { OfframpQueueFlowSchemaV2 } from '@/background-processing/schema';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import env from '@/constants/env';
import { OFFRAMP, OFFRAMP_WITHDRAW_REFERENCE_PREFIX } from '@/constants/strings';
import { dbClient } from '@/db/dbClient';
import logger from '@/resources/logger';
import { generateReceivedTokenMessage } from '@/resources/utils/bot-message-utils';
import { getTransactionExplorerUrl } from '@/resources/web3/core/explorerUrls';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';

const DEPOSIT_SILENT_MODE = false;

const blockradarWebhookService = new BlockradarMasterWalletWebhookService({
    // Todo: Move handler implementation to appropriate service
    handleDepositSuccess: async (data, network) => {
        const userId = data.data.metadata?.userId;
        const blockradarAsset = data.data.asset;
        const platformAssetConfig = azzaWalletManager.searchAssets({
            tokenName: blockradarAsset.symbol,
            network,
        })[0];
        const amount = data.data.amount;
        const senderAddress = data.data.senderAddress;
        const transactionHash = data.data.hash;

        if (DEPOSIT_SILENT_MODE) {
            console.log(`Deposit success: ${transactionHash}`, {
                platformAssetConfig,
                amount,
                userId,
                blockradarAsset,
            });

            return;
        }

        if (!userId || !platformAssetConfig) {
            if (!data.data.address.name?.toLowerCase().includes('offramp'))
                await logger.debug(`Invalid deposit success data: ${transactionHash}`, {
                    data,
                    userId,
                    platformAssetConfig,
                });
            return;
        }

        const [newBalance, user] = await Promise.all([
            azzaWalletManager.getAssetBalance({
                userId,
                assetId: platformAssetConfig.listItemId,
            }),
            userServiceV2.getUserById(userId),
        ]);

        if (!user) {
            return;
        }

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

        const userPhoneNumber = user.primaryWhatsappPhoneNumber;

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

        if (reason === OFFRAMP) {
            const pendingOfframpId = reference.split(OFFRAMP_WITHDRAW_REFERENCE_PREFIX)[1];
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
                    user.primaryWhatsappPhoneNumber!,
                    '✅ Crypto debit transaction confirmed!'
                )
            );

            await addOfframpRequestToQueue(
                OfframpQueueFlowSchemaV2.parse({
                    userId: pendingOfframpRequest.ownerId!,
                    conversionRate: pendingOfframpRequest.conversionRate!,
                    localAmount: pendingOfframpRequest.localAmount!,
                    hotWalletAddress: pendingOfframpRequest.hotWalletAddress!,
                    transactionFeeUsd: pendingOfframpRequest.transactionFeeUsd!,
                    beneficiaryId: pendingOfframpRequest.beneficiaryId!,
                    usdAmount: pendingOfframpRequest.usdAmount!,
                    platformFeePercentage: pendingOfframpRequest.platformFeePercentage!,
                    userWalletAddress: pendingOfframpRequest.fromWalletAddress!,
                    tokenAddress: assetConfig.tokenAddress,
                    tokenName: assetConfig.tokenName,
                    chainName: assetConfig.network.toUpperCase(),
                    txHash: data.data.hash,
                    whatsappParams: {
                        businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        userPhoneNumber: user.primaryWhatsappPhoneNumber!,
                    },
                })
            );
        }
    },
});

export default blockradarWebhookService;
