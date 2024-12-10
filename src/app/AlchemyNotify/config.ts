import { SupportedChain } from '@/app/WalletKit/walletKitSchema';

export type ChainsWithNotifySupport = Exclude<SupportedChain, 'Solana' | 'Lisk'>;

export const chainsWithNotifySupport: ChainsWithNotifySupport[] = [
    'Base',
    'Ethereum',
    'Optimism',
    'Polygon',
];

export const isChainWithNotifySupport = (
    chain: SupportedChain
): chain is ChainsWithNotifySupport => {
    return chainsWithNotifySupport.includes(chain as ChainsWithNotifySupport);
};

/**
 * @dev Webhook IDs for Alchemy Notify.
 * Docs: https://docs.alchemy.com/reference/notify-api-quickstart
 * @notice These IDs are specific to the Alchemy account hosting the webhook service.
 * @notice Do not use these IDs for other Alchemy accounts.
 * */

const WEBHOOK_IDS: {
    [key in ChainsWithNotifySupport]: string;
} = {
    Base: 'wh_m2tq7i37fj4u8n5m',
    Ethereum: 'wh_ohv91kqssbz8nj46',
    Optimism: 'wh_q7qhcmkf11eq25vv',
    Polygon: 'wh_s2kxghl9wa76cxuc',
};

export const getWebhookId = (network: ChainsWithNotifySupport) => WEBHOOK_IDS[network];
