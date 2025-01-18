import AzzaWalletManager from '@/app/AzzaWalletManager';
import BlockradarWalletProvider from '@/app/AzzaWalletManager/providers/blockradar/BlockradarWalletProvider';
import {
    getBlockradarAssetId,
    getPlatformAssetId,
} from '@/app/AzzaWalletManager/providers/blockradar/resources/assets';
import { getMasterWalletClient } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import {
    assetsWithRequiredBlockradarConfig,
    blockchainsEnabledOnBlockradar,
} from '@/app/runtime/blockradar';
import userServiceV2 from '@/app/runtime/user';
import logger from '@/resources/logger';
import { isEvmNetwork } from '@/resources/web3/evm/evm.config';

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
