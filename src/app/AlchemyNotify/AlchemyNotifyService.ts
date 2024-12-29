import { ChainsWithNotifySupport } from '@/app/AlchemyNotify/config';
import { type AlchemyAddressActivityWebhookEvent } from '@/app/AlchemyNotify/webhookUtils';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { getAssetConfigByTokenAddress } from '@/config/whatsAppBot';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import { generateReceivedTokenMessage } from '@/resources/utils/bot-message-utils';
import { getTransactionExplorerUrl } from '@/resources/web3/explorerUrls';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import { manageAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import env from '@/constants/env';
import {
    BASE_URL,
    UPDATE_WEBHOOK_ADDRESSES,
    WEBHOOK_ADDRESSES,
} from '@/app/AlchemyNotify/endpoints';
import axios from 'axios';
import { OK } from '@/constants/status-codes';

enum AlchemyActivityCategory {
    TOKEN = 'token',
    INTERNAL = 'internal',
}

const transferLogTopicHash = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

class AlchemyNotifyService {
    private static readonly BASE_API_URL = BASE_URL;
    private static authToken: string = env.ALCHEMY_AUTH_TOKEN;

    public static async handleAddressActivityNotification(
        payload: AlchemyAddressActivityWebhookEvent,
        network: SupportedChain
    ) {
        if (payload.type !== 'ADDRESS_ACTIVITY') {
            return;
        }

        console.dir(payload, { depth: null });

        const targetActivity = payload.event.activity.find((activity) => {
            const rawContract = activity.rawContract;
            const activityCategory = activity.category;
            const activityLog = activity.log;

            if (activityCategory === AlchemyActivityCategory.TOKEN) {
                return (
                    activityCategory === AlchemyActivityCategory.TOKEN &&
                    activityLog.topics.includes(transferLogTopicHash) &&
                    rawContract
                );
            }

            if (activityCategory === AlchemyActivityCategory.INTERNAL) {
                const typeTraceAddress = activity.typeTraceAddress;
                return activity.value > 0 && !typeTraceAddress?.startsWith('DELEGATECALL');
            }

            return false;
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

            // Owner ID should be a valid phone number with digits
            if (!toUserWalletData.owner_id.match(/^\d+$/)) {
                return;
            }

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

    public static async addWebhookAddresses(walletAddresses: Array<string>, webhookId: string) {
        const requestUrl = `${this.BASE_API_URL}${UPDATE_WEBHOOK_ADDRESSES}`;

        const response = await axios.patch(
            requestUrl,
            {
                webhook_id: webhookId,
                addresses_to_add: walletAddresses,
                addresses_to_remove: [],
            },
            {
                headers: {
                    'X-Alchemy-Token': this.authToken,
                },
            }
        );

        return response.status === OK;
    }

    public static async getWebhookAddresses(
        webhookId: string,
        pagination: {
            limit: number;
            offset: number;
        }
    ) {
        const requestUrl = `${this.BASE_API_URL}${WEBHOOK_ADDRESSES}?webhook_id=${webhookId}&limit=${pagination.limit}&after=${pagination.offset}`;

        const response = await axios.get(requestUrl, {
            headers: {
                'X-Alchemy-Token': this.authToken,
            },
        });

        return response.data;
    }

    public static get signingKeys(): Record<ChainsWithNotifySupport, string> {
        return {
            Base: env.ALCHEMY_NOTIFY_FORWARDER_BASE_SIGNING_KEY,
            Polygon: env.ALCHEMY_NOTIFY_FORWARDER_POLYGON_SIGNING_KEY,
            Ethereum: env.ALCHEMY_NOTIFY_FORWARDER_ETH_SIGNING_KEY,
            Optimism: env.ALCHEMY_NOTIFY_FORWARDER_OPTIMISM_SIGNING_KEY,
        };
    }

    public static withAuthToken(authToken: string) {
        this.authToken = authToken;

        return this;
    }
}

export default AlchemyNotifyService;
