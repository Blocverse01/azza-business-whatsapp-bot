import { type AlchemyAddressActivityWebhookEvent } from '@/app/AlchemyNotify/webhookUtils';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { getAssetConfigByTokenAddress } from '@/config/whatsAppBot';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import { generateReceivedTokenMessage } from '@/Resources/utils/bot-message-utils';
import { getTransactionExplorerUrl } from '@/Resources/web3/explorerUrls';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import { manageAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import env from '@/constants/env';
import { BASE_URL, UPDATE_WEBHOOK_ADDRESSES } from '@/app/AlchemyNotify/endpoints';
import axios from 'axios';
import { getWebhookId } from '@/app/AlchemyNotify/config';
import { OK } from '@/constants/status-codes';
import { convertBase64ToAsciiString, decryptWithPrivateKey } from '@/Resources/utils/encryption';

enum AlchemyActivityCategory {
    TOKEN = 'token',
}

const transferLogTopicHash = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

class AlchemyNotifyService {
    private static readonly BASE_API_URL = BASE_URL;

    public static async handleAddressActivityNotification(
        payload: AlchemyAddressActivityWebhookEvent,
        network: SupportedChain
    ) {
        if (payload.type !== 'ADDRESS_ACTIVITY') {
            return;
        }

        const targetActivity = payload.event.activity.find((activity) => {
            const rawContract = activity.rawContract;
            const activityCategory = activity.category;
            const activityLog = activity.log;

            return (
                activityCategory === AlchemyActivityCategory.TOKEN &&
                activityLog.topics.includes(transferLogTopicHash) &&
                rawContract
            );
        });

        if (!targetActivity) {
            return;
        }

        const { fromAddress, toAddress, value, rawContract } = targetActivity;

        const assetConfig = getAssetConfigByTokenAddress(rawContract.address);

        if (!assetConfig) {
            return;
        }

        const [fromUserWallet, toUserUserWallet, receiverAssetBalance] = await Promise.allSettled([
            WalletKitService.getWalletByAddress(fromAddress, network),
            WalletKitService.getWalletByAddress(toAddress, network),
            WalletKitService.getBalance(toAddress, network, assetConfig.tokenAddress),
        ]);

        if (fromUserWallet.status === 'rejected' && toUserUserWallet.status === 'rejected') {
            return;
        }

        const fromUserWalletData =
            fromUserWallet.status === 'fulfilled' ? fromUserWallet.value : null;
        const toUserWalletData =
            toUserUserWallet.status === 'fulfilled' ? toUserUserWallet.value : null;
        const receiverAssetBalanceData =
            receiverAssetBalance.status === 'fulfilled' ? receiverAssetBalance.value : null;

        if (!fromUserWalletData && !toUserWalletData) {
            return;
        }

        if (fromUserWalletData) {
            // Send notification to fromUserWalletData
        }
        if (toUserWalletData) {
            // Send notification to toUserWalletData
            const message = generateReceivedTokenMessage({
                tokenAmount: value.toString(),
                assetName: assetConfig.tokenName,
                assetNetwork: network,
                senderAddress: fromAddress,
                transactionHash: targetActivity.hash,
                explorerUrl: getTransactionExplorerUrl(targetActivity.hash, network),
                newTokenBalance: receiverAssetBalanceData ?? '0',
            });

            const assetInteractiveMessage = MessageGenerators.generateInteractiveListMessage({
                recipient: toUserWalletData.owner_id,
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
        }
    }

    public static async addWebhookAddresses(
        walletAddresses: Array<string>,
        network: SupportedChain
    ) {
        const requestUrl = `${this.BASE_API_URL}${UPDATE_WEBHOOK_ADDRESSES}`;

        const response = await axios.patch(
            requestUrl,
            {
                webhook_id: getWebhookId(network),
                addresses_to_add: walletAddresses,
                addresses_to_remove: [],
            },
            {
                headers: {
                    'X-Alchemy-Token': env.ALCHEMY_AUTH_TOKEN,
                },
            }
        );

        return response.status === OK;
    }

    public static get signingKeys(): Record<SupportedChain, string> {
        const decryptedKeysString = decryptWithPrivateKey(
            env.ALCHEMY_NOTIFY_SIGNING_KEYS,
            convertBase64ToAsciiString(env.CRYPTO_PAYOUT_AUTHORIZER_PRIVATE_KEY),
            env.CRYPTO_PAYOUT_AUTHORIZER_PASSPHRASE
        );

        return JSON.parse(decryptedKeysString);
    }
}

export default AlchemyNotifyService;
