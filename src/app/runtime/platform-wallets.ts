import AzzaWalletManager from '@/app/AzzaWalletManager';
import BlockradarWalletProvider from '@/app/AzzaWalletManager/providers/blockradar/BlockradarWalletProvider';
import {
    getBlockradarAssetId,
    getPlatformAssetId,
} from '@/app/AzzaWalletManager/providers/blockradar/resources/assets';
import {
    AllSupportedBlockchains,
    getMasterWalletClient,
} from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import {
    assetsWithRequiredBlockradarConfig,
    blockchainsEnabledOnBlockradar,
} from '@/app/runtime/blockradar';
import logger from '@/resources/logger';
import { isEvmNetwork } from '@/resources/web3/evm/evm.config';

export type PlatformAddressIdNetworkTag = 'evm' | 'solana' | 'tron';
type PlatformAddressUserIdPrefix = 'onramp-payout' | 'offramp-hot-wallet';

export type PlatformAddressIdKey = `${PlatformAddressUserIdPrefix}-${PlatformAddressIdNetworkTag}`;

const platformAddressIdRecords: Record<PlatformAddressIdKey, string> = {
    'onramp-payout-evm': 'payout-evm',
    'onramp-payout-solana': 'payout-solana',
    'onramp-payout-tron': 'payout-tron',
    'offramp-hot-wallet-evm': 'offramp-hot-wallet-evm',
    'offramp-hot-wallet-solana': 'offramp-hot-wallet-solana',
    'offramp-hot-wallet-tron': 'offramp-hot-wallet-tron',
};

export const getNetworkTag = (network: AllSupportedBlockchains) => {
    return isEvmNetwork(network)
        ? ('evm' as const)
        : (network.toLowerCase() as PlatformAddressIdNetworkTag);
};

export const composePlatformAddressIdKey = (
    platformUserIdPrefix: PlatformAddressUserIdPrefix,
    network: AllSupportedBlockchains
) => {
    const networkTag = getNetworkTag(network);

    return `${platformUserIdPrefix}-${networkTag}` as PlatformAddressIdKey;
};

export const getPlatformAddressId = (
    platformUserIdPrefix: PlatformAddressUserIdPrefix,
    network: AllSupportedBlockchains
) => {
    return Promise.resolve(
        platformAddressIdRecords[composePlatformAddressIdKey(platformUserIdPrefix, network)]
    );
};

const platformWalletProvider = new BlockradarWalletProvider({
    dataSources: {
        platformAssetConfigs: () => assetsWithRequiredBlockradarConfig,
        supportedNetworks: () => blockchainsEnabledOnBlockradar,
        blockradarAssetId: getBlockradarAssetId,
        blockradarMasterWalletClient: getMasterWalletClient,
        userAddressId: (platformUserIdPrefix: string, network: AllSupportedBlockchains) =>
            getPlatformAddressId(platformUserIdPrefix as PlatformAddressUserIdPrefix, network),
        platformAssetId: getPlatformAssetId,
    },
    networkUtils: {
        isEvmNetwork: isEvmNetwork,
    },
    logger: logger,
});
const platformWalletManager = new AzzaWalletManager(platformWalletProvider);

export default platformWalletManager;
