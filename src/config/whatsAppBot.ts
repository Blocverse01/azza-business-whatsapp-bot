import {
    AssetConfig,
    usdcBaseConfig,
    usdcEthConfig,
    usdcOptimismConfig,
    usdcPolygonConfig,
    usdtEthConfig,
    usdtOptimismConfig,
    usdtPolygonConfig,
    usdtTronConfig,
    usdcSolanaConfig,
    usdtSolanaConfig,
    solConfig,
    ethBaseConfig,
    ethEthereumConfig,
} from '@/resources/web3/tokens';

export const ENABLED_ASSETS = [
    usdcEthConfig,
    usdtEthConfig,
    usdcOptimismConfig,
    usdtOptimismConfig,
    usdcPolygonConfig,
    usdtPolygonConfig,
    usdcBaseConfig,
    usdtTronConfig,
    usdcSolanaConfig,
    usdtSolanaConfig,
    solConfig,
    ethBaseConfig,
    ethEthereumConfig,
];

// Get asset config by list item id
export const getAssetConfigOrThrow = (listItemId: string): AssetConfig => {
    const assetConfig = ENABLED_ASSETS.find((asset) => asset.listItemId === listItemId);

    if (!assetConfig) {
        throw new Error(`Asset with list item id ${listItemId} not found`);
    }

    return assetConfig;
};

export const getAssetConfigByTokenAddress = (tokenAddress: string) => {
    return ENABLED_ASSETS.find(
        (asset) => asset.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    );
};

export const searchAsset = (searchParams: Partial<Pick<AssetConfig, 'network' | 'tokenName'>>) => {
    return ENABLED_ASSETS.filter((asset) => {
        return Object.entries(searchParams).every(([key, value]) => {
            return asset[key as keyof AssetConfig] === value;
        });
    });
};
