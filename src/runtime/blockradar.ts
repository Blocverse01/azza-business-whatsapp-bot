import { hasBlockradarAssetId } from '@/app/AzzaWalletManager/providers/blockradar/resources/assets';
import { AllSupportedBlockchains } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import { ENABLED_ASSETS } from '@/config/whatsAppBot';

export const blockchainsEnabledOnBlockradar: Array<AllSupportedBlockchains> = [
    'Tron',
    'Ethereum',
    'Polygon',
    'Optimism',
    'Base',
    'Bep20',
    'Solana',
];
export const assetsWithRequiredBlockradarConfig = ENABLED_ASSETS.filter(
    (asset) =>
        hasBlockradarAssetId(asset.listItemId) &&
        blockchainsEnabledOnBlockradar.includes(asset.network)
);
