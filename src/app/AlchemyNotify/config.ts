import { SupportedChain } from '@/app/WalletKit/walletKitSchema';

/**
 * @dev Webhook IDs for Alchemy Notify.
 * Docs: https://docs.alchemy.com/reference/notify-api-quickstart
 * @notice These IDs are specific to the Alchemy account hosting the webhook service.
 * @notice Do not use these IDs for other Alchemy accounts.
 * */

const WEBHOOK_IDS: {
    [key in SupportedChain]: string;
} = {
    Base: 'wh_jj5gugj65pifoq77',
    Ethereum: 'wh_womq044l3rjzvip5',
    Optimism: 'wh_5044b13c616n0gj3',
    Polygon: 'wh_mzkvd0x4ephzca9b',
};

export const getWebhookId = (network: SupportedChain) => WEBHOOK_IDS[network];
