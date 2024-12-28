import { ExploreAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import { ENABLED_ASSETS } from '@/config/whatsAppBot';

type SupportedAssetFilters = {
    action?: ExploreAssetActions;
};

export function getSupportedAssetAndNetworksText(filter: SupportedAssetFilters = {}) {
    const supportedTokenNames = ENABLED_ASSETS.map((asset) => asset.tokenName);

    const uniqueSupportedTokenNames = Array.from(new Set(supportedTokenNames));

    return uniqueSupportedTokenNames
        .map((tokenName) => {
            const supportedNetworks = ENABLED_ASSETS.filter(
                (asset) =>
                    asset.tokenName === tokenName &&
                    (!filter.action || asset.supportedAssetActions.includes(filter.action))
            ).map((asset) => asset.network);
            return supportedNetworks.length > 0
                ? `- ${tokenName}: ${supportedNetworks.join(', ')}`
                : '';
        })
        .filter(Boolean)
        .join('\n');
}
