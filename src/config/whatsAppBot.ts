import {
    AssetConfig,
    usdcBaseConfig,
    usdcEthConfig,
    usdcOptimismConfig,
    usdcPolygonConfig,
    usdtEthConfig,
    usdtOptimismConfig,
    usdtPolygonConfig,
} from '@/Resources/web3/tokens';

export const ENABLED_ASSETS = [
    usdcEthConfig,
    usdtEthConfig,
    usdcOptimismConfig,
    usdtOptimismConfig,
    usdcPolygonConfig,
    usdtPolygonConfig,
    usdcBaseConfig,
];

// Get asset config by list item id
export const getAssetConfigOrThrow = (listItemId: string): AssetConfig => {
    const assetConfig = ENABLED_ASSETS.find((asset) => asset.listItemId === listItemId);

    if (!assetConfig) {
        throw new Error(`Asset with list item id ${listItemId} not found`);
    }

    return assetConfig;
};
