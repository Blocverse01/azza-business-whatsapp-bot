import AzzaWalletManager from '@/app/AzzaWalletManager';
import BlockradarWalletProvider from '@/app/AzzaWalletManager/providers/blockradar/BlockradarWalletProvider';
import {
    getBlockradarAssetId,
    getPlatformAssetId,
    hasBlockradarAssetId,
} from '@/app/AzzaWalletManager/providers/blockradar/resources/assets';
import {
    AllSupportedBlockchains,
    getMasterWalletClient,
} from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import userServiceV2 from '@/app/runtime/user';
import { ENABLED_ASSETS } from '@/config/whatsAppBot';
import logger from '@/resources/logger';
import { isEvmNetwork } from '@/resources/web3/evm/evm.config';

const blockchainsEnabledOnBlockradar: Array<AllSupportedBlockchains> = [
    'Tron',
    'Ethereum',
    'Polygon',
    'Optimism',
    'Base',
    'Bep20',
    'Solana',
];
const assetsWithRequiredBlockradarConfig = ENABLED_ASSETS.filter(
    (asset) =>
        hasBlockradarAssetId(asset.listItemId) &&
        blockchainsEnabledOnBlockradar.includes(asset.network)
);

const walletProvider = new BlockradarWalletProvider({
    dataSources: {
        platformAssetConfigs: () => assetsWithRequiredBlockradarConfig,
        supportedNetworks: () => blockchainsEnabledOnBlockradar,
        blockradarAssetId: getBlockradarAssetId,
        blockradarMasterWalletClient: getMasterWalletClient,
        userAddressId: (userId: string, network: string) =>
            userServiceV2.getUserBlockradarWalletAddressId(userId, network),
        platformAssetId: getPlatformAssetId,
    },
    networkUtils: {
        isEvmNetwork: isEvmNetwork,
    },
    logger: logger,
});

const azzaWalletManager = new AzzaWalletManager(walletProvider);
export default azzaWalletManager;
