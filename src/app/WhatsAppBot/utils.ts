import { ExploreAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import azzaWalletManager from '@/runtime/wallet';

type SupportedAssetFilters = {
    action?: ExploreAssetActions;
};

export function getSupportedAssetAndNetworksText(filter: SupportedAssetFilters = {}) {
    const supportedAssets = azzaWalletManager.getSupportedAssets();
    const supportedTokenNames = supportedAssets.map((asset) => asset.tokenName);

    const uniqueSupportedTokenNames = Array.from(new Set(supportedTokenNames));

    return uniqueSupportedTokenNames
        .map((tokenName) => {
            const supportedNetworks = supportedAssets
                .filter(
                    (asset) =>
                        asset.tokenName === tokenName &&
                        (!filter.action || asset.supportedAssetActions.includes(filter.action))
                )
                .map((asset) => asset.network);
            return supportedNetworks.length > 0
                ? `- ${tokenName}: ${supportedNetworks.join(', ')}`
                : '';
        })
        .filter(Boolean)
        .join('\n');
}
