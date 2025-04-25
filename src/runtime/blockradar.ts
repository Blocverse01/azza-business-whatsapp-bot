import { hasBlockradarAssetId } from '@/app/AzzaWalletManager/providers/blockradar/resources/assets';
import { ENABLED_ASSETS } from '@/config/whatsAppBot';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';

export const blockchainsEnabledOnBlockradar: Array<AllSupportedBlockchains> = [
    'Tron',
    'Ethereum',
    'Polygon',
    'Optimism',
    'Base',
    'Bep20',
    'Solana',
    'AssetChain',
    'Arbitrum',
    'Lisk',
];
export const assetsWithRequiredBlockradarConfig = ENABLED_ASSETS.filter(
    (asset) =>
        hasBlockradarAssetId(asset.listItemId) &&
        blockchainsEnabledOnBlockradar.includes(asset.network)
);
