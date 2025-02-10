import { AssetInteractiveButtonIds } from '@/app/WhatsAppBot/WhatsAppBotType';
import env from '@/constants/env';

const testnet__blockradarAssetIdMap: Record<string, string> = {
    [AssetInteractiveButtonIds.USDC_ETH]: 'a2384b79-2dd8-468a-aee5-6581d86f0c7f',
    [AssetInteractiveButtonIds.ETH_ETHEREUM]: '6147af66-6702-4d2d-b125-6c47f9156189',
    [AssetInteractiveButtonIds.USDT_BEP20]: '0ee7dab5-aa27-4a54-9513-455b10bdd73a',
    [AssetInteractiveButtonIds.BNB_BEP20]: '18b9aead-ff3c-44db-9b1b-9de9e7b679cd',
    [AssetInteractiveButtonIds.USDC_POLYGON]: '06b90507-8660-4dbd-8fe7-8dc5e8d1780c',
    [AssetInteractiveButtonIds.POL_POLYGON]: 'b9e792a8-194f-4949-a494-343720440147',
    [AssetInteractiveButtonIds.USDT_TRON]: 'bc9185be-8ac6-4fa6-bfeb-e774b0a29089',
    [AssetInteractiveButtonIds.TRX]: '918a9427-bb3d-462d-87f4-19b43ea4ab34',
    [AssetInteractiveButtonIds.USDC_BASE]: '6eb24b00-536e-42a2-bc99-5bd0558ad89b',
    [AssetInteractiveButtonIds.ETH_BASE]: '06778583-aa3a-4b3a-a212-5282ddc2af77',
    [AssetInteractiveButtonIds.USDC_OPTIMISM]: 'e4724aa5-b6a8-4dcb-8ba2-87e9ecd13406',
    [AssetInteractiveButtonIds.ETH_OPTIMISM]: 'd6150b49-a14e-4550-a2b6-c18e59282e45',
    [AssetInteractiveButtonIds.SOL]: '0d7a1412-42b0-4e6c-84b8-a509d8d0b120',
    [AssetInteractiveButtonIds.USDC_SOLANA]: 'c962060c-ebcd-4b82-a17c-c51305416c11',
};

const mainnet__blockradarAssetIdMap: Record<string, string> = {
    [AssetInteractiveButtonIds.USDC_ETH]: '5456b8ab-45fe-4ee5-8626-0729b604f077',
    [AssetInteractiveButtonIds.USDT_ETH]: '42c24f83-4270-46a7-9f4c-c7175de7f89a',
    [AssetInteractiveButtonIds.ETH_ETHEREUM]: '04038a2f-e627-49f3-9fa0-5ac99593d81b',
    [AssetInteractiveButtonIds.USDC_BEP20]: 'f2e5ad81-a3a0-4a70-a047-5a6c5abe3566',
    [AssetInteractiveButtonIds.USDT_BEP20]: '7c56a91a-d98c-4a22-afe8-282bbe30539e',
    [AssetInteractiveButtonIds.BNB_BEP20]: '12e29e8b-81d1-4961-b48e-b7e4c98351ca',
    [AssetInteractiveButtonIds.USDC_POLYGON]: '16396a2d-affd-4d38-bb35-6e29f8a1042b',
    [AssetInteractiveButtonIds.USDT_POLYGON]: '22796ff3-eee1-4afe-8d21-1403dae52366',
    [AssetInteractiveButtonIds.POL_POLYGON]: '96bda4d6-0292-43e3-ad01-21091ea84ecd',
    [AssetInteractiveButtonIds.USDT_TRON]: 'dd9c8317-9350-4ccd-a819-c651829e400e',
    [AssetInteractiveButtonIds.TRX]: '45b78c65-6ad8-4371-b682-c388f407ca17',
    [AssetInteractiveButtonIds.USDC_BASE]: 'd504c83c-5c99-41a9-a8e2-ef56166643c3',
    [AssetInteractiveButtonIds.USDT_BASE]: '2dec164d-85aa-42e8-baae-e328d1ecbd55',
    [AssetInteractiveButtonIds.ETH_BASE]: 'fc4c8454-4a83-4da0-bc0e-f9f10d928e4c',
    [AssetInteractiveButtonIds.USDC_OPTIMISM]: 'c7433a42-101e-4af9-8dc8-c3a8b16e19d6',
    [AssetInteractiveButtonIds.USDT_OPTIMISM]: '79e7ac82-11d9-4108-b1c2-dfcca3dd6bf8',
    [AssetInteractiveButtonIds.ETH_OPTIMISM]: '164b5544-5f8b-4683-ace8-31d1f21d277b',
    [AssetInteractiveButtonIds.USDC_SOLANA]: 'dc2bb1ea-00ef-454d-89ea-18bcba9d40b1',
    [AssetInteractiveButtonIds.USDT_SOLANA]: '4bcd19e6-2c28-4855-8e79-525b0b3d44d1',
    [AssetInteractiveButtonIds.SOL]: '5b4a3d28-6b19-4b5f-b734-0c32feeb0aa5',
    [AssetInteractiveButtonIds.USDT_ASSET_CHAIN]: 'ee768b78-26b4-4c11-9d06-7eb22251958f',
    [AssetInteractiveButtonIds.USDC_ASSET_CHAIN]: 'ee29932b-a3d4-4dd5-a491-be5177c52bdc',
};

const blockradarAssetIdMap =
    env.WEB3_ENVIRONMENT === 'mainnet'
        ? mainnet__blockradarAssetIdMap
        : testnet__blockradarAssetIdMap;

export const getBlockradarAssetId = (assetId: string): string => {
    const blockradarAssetId = blockradarAssetIdMap[assetId];

    if (!blockradarAssetId) {
        throw new Error(`Blockradar asset id not found for asset id: ${assetId}`);
    }

    return blockradarAssetId;
};

export const getPlatformAssetId = (blockradarAssetId: string): string | null => {
    return (
        Object.keys(blockradarAssetIdMap).find(
            (key) => blockradarAssetIdMap[key] === blockradarAssetId
        ) ?? null
    );
};

export const hasBlockradarAssetId = (assetId: string): boolean => {
    return !!blockradarAssetIdMap[assetId];
};
