import AzzaWalletManager from '@/app/AzzaWalletManager';
import BlockradarWalletProvider from '@/app/AzzaWalletManager/providers/blockradar/BlockradarWalletProvider';
import {
    getBlockradarAssetId,
    getPlatformAssetId,
} from '@/app/AzzaWalletManager/providers/blockradar/resources/assets';
import { getMasterWalletClient } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import logger from '@/resources/logger';
import { isEvmCompatibleBlockchain } from '@/resources/web3/core/blockchains';
import {
    assetsWithRequiredBlockradarConfig,
    blockchainsEnabledOnBlockradar,
} from '@/runtime/blockradar';
import userServiceV2 from '@/runtime/user';

const walletProvider = new BlockradarWalletProvider({
    dataSources: {
        platformAssetConfigs: () => assetsWithRequiredBlockradarConfig,
        supportedNetworks: () => blockchainsEnabledOnBlockradar,
        blockradarAssetId: getBlockradarAssetId,
        blockradarMasterWalletClient: getMasterWalletClient,
        userAddressId: (userId: string, network: string) =>
            userServiceV2.getUserBlockradarWalletAddressId(userId, network),
        platformAssetId: getPlatformAssetId,
        syncUserAddress: (params) =>
            userServiceV2.createUserBlockradarWallet(params.userId, {
                addressId: params.addressId,
                address: params.address,
                blockchainNetwork: params.network,
            }),
    },
    networkUtils: {
        isEvmCompatibleBlockchain,
    },
    logger: logger,
});
const azzaWalletManager = new AzzaWalletManager(walletProvider);

export default azzaWalletManager;
