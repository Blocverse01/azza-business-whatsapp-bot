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
import env from '@/constants/env';
import logger from '@/resources/logger';
import { isEvmNetwork } from '@/resources/web3/evm/evm.config';

export type PlatformAddressIdNetworkTag = 'evm' | 'solana' | 'tron';
type PlatformAddressUserIdPrefix = 'onramp-payout' | 'offramp-hot-wallet';

export type PlatformAddressIdKey = `${PlatformAddressUserIdPrefix}-${PlatformAddressIdNetworkTag}`;

const mainnet__PlatformAddressIdRecords: Record<PlatformAddressIdKey, string> = {
    'onramp-payout-evm': '',
    'onramp-payout-solana': '',
    'onramp-payout-tron': '',
    'offramp-hot-wallet-evm': '',
    'offramp-hot-wallet-solana': '',
    'offramp-hot-wallet-tron': '',
};
const testnet__PlatformAddressIdRecords: Record<PlatformAddressIdKey, string> = {
    'onramp-payout-evm': 'f44866a3-6881-4089-afbb-ae83996cd9b8',
    'onramp-payout-solana': '9db5279e-5abc-4a80-b400-39c4757e5b45',
    'onramp-payout-tron': '174f76b7-f11a-406e-b73f-693b31a5af96',
    'offramp-hot-wallet-evm': '76729de7-1425-47de-9baf-7e91897e404c',
    'offramp-hot-wallet-solana': '3a3ec592-f95d-4918-a18c-2e27900234e3',
    'offramp-hot-wallet-tron': 'ef0bb6ea-1dc6-4b1e-ac36-aa23fb80d7f5',
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
    const source =
        env.WEB3_ENVIRONMENT === 'mainnet'
            ? mainnet__PlatformAddressIdRecords
            : testnet__PlatformAddressIdRecords;

    return Promise.resolve(source[composePlatformAddressIdKey(platformUserIdPrefix, network)]);
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
