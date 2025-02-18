import BlockradarMasterWalletWebhookService from '@/app/Blockradar/BlockradarMasterWalletWebhookService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { manageAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import env from '@/constants/env';
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
            await logger.error(`Invalid deposit success data: ${transactionHash}`, {
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
});

export default blockradarWebhookService;
