import BlockradarMasterWalletApiClient, {
    BlockradarMasterWalletApiClientConstructorParams,
} from '@/app/Blockradar/BlockradarMasterWalletApiClient';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import env from '@/constants/env';

export type AllSupportedBlockchains = SupportedChain | ExtendedWalletSupportedNetworks;
export type EvmNetwork = Exclude<AllSupportedBlockchains, 'Solana' | 'Tron'>;

const BASE_URL = 'https://api.blockradar.co/v1';

const masterWalletApiConfig: Record<
    AllSupportedBlockchains,
    Pick<BlockradarMasterWalletApiClientConstructorParams, 'masterWalletId' | 'apiKey'>
> = {
    Base: {
        masterWalletId: '3204a5f3-fc2f-4e95-8a08-e8ae77eb4b22',
        apiKey: env.BASE_MASTER_WALLET_API_KEY,
    },
    Optimism: {
        masterWalletId: 'd60155ef-8fae-4107-a31f-3086a858c508',
        apiKey: env.OPTIMISM_MASTER_WALLET_API_KEY,
    },
    Tron: {
        masterWalletId: 'efd62742-fbe2-4447-99ae-9cf5cd755755',
        apiKey: env.TRON_MASTER_WALLET_API_KEY,
    },
    Bep20: {
        masterWalletId: '369ba83b-6545-4132-868c-2bbab7c88c52',
        apiKey: env.BSC_MASTER_WALLET_API_KEY,
    },
    Solana: {
        masterWalletId: 'f3fe5449-c8c8-4cc8-97fe-a751cee8412a',
        apiKey: env.SOLANA_MASTER_WALLET_API_KEY,
    },
    Polygon: {
        masterWalletId: '6e0083bc-8444-43f1-97e9-5960b94adc71',
        apiKey: env.POLYGON_MASTER_WALLET_API_KEY,
    },
    Ethereum: {
        masterWalletId: '0cbe04f6-2168-4727-82d4-c81e30c3516c',
        apiKey: env.ETHEREUM_MASTER_WALLET_API_KEY,
    },
};

const masterWalletClients: Map<AllSupportedBlockchains, BlockradarMasterWalletApiClient> =
    new Map();

export const getMasterWalletClient = (
    blockchain: AllSupportedBlockchains
): BlockradarMasterWalletApiClient => {
    if (!masterWalletClients.has(blockchain)) {
        const client = new BlockradarMasterWalletApiClient(getMasterWalletConfig(blockchain));
        masterWalletClients.set(blockchain, client);
    }

    return masterWalletClients.get(blockchain)!;
};

export const getMasterWalletConfig = (
    blockchain: AllSupportedBlockchains
): BlockradarMasterWalletApiClientConstructorParams => {
    const config = masterWalletApiConfig[blockchain];
    if (!config) {
        throw new MissingConfigError(blockchain);
    }
    return {
        ...config,
        baseUrl: BASE_URL,
    };
};

class MissingConfigError extends Error {
    constructor(blockchain: AllSupportedBlockchains) {
        super(`No master wallet config found for blockchain: ${blockchain}`);
        this.name = 'MissingConfigError';
    }
}
