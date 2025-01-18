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
    [AssetInteractiveButtonIds.USDC_ETH]: '',
    [AssetInteractiveButtonIds.ETH_ETHEREUM]: '',
    [AssetInteractiveButtonIds.USDT_BEP20]: '',
    [AssetInteractiveButtonIds.BNB_BEP20]: '',
    [AssetInteractiveButtonIds.USDC_POLYGON]: '',
    [AssetInteractiveButtonIds.POL_POLYGON]: '',
    [AssetInteractiveButtonIds.USDT_TRON]: '',
    [AssetInteractiveButtonIds.TRX]: '',
    [AssetInteractiveButtonIds.USDC_BASE]: '',
    [AssetInteractiveButtonIds.ETH_BASE]: '',
    [AssetInteractiveButtonIds.USDC_OPTIMISM]: '',
    [AssetInteractiveButtonIds.ETH_OPTIMISM]: '',
    [AssetInteractiveButtonIds.SOL]: '',
    [AssetInteractiveButtonIds.USDC_SOLANA]: '',
};

export const getBlockradarAssetId = (assetId: string): string => {
    const blockradarAssetId =
        env.WEB3_ENVIRONMENT === 'mainnet'
            ? mainnet__blockradarAssetIdMap[assetId]
            : testnet__blockradarAssetIdMap[assetId];

    if (!blockradarAssetId) {
        throw new Error(`Blockradar asset id not found for asset id: ${assetId}`);
    }

    return blockradarAssetId;
};

export const getPlatformAssetId = (blockradarAssetId: string): string | null => {
    return (
        Object.keys(testnet__blockradarAssetIdMap).find(
            (key) => testnet__blockradarAssetIdMap[key] === blockradarAssetId
        ) ?? null
    );
};

export const hasBlockradarAssetId = (assetId: string): boolean => {
    return !!testnet__blockradarAssetIdMap[assetId];
};
