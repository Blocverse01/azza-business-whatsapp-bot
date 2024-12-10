import { extendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { SupportedChain, supportedChainSchema } from '@/app/WalletKit/walletKitSchema';
import { ExploreAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import { dbClient } from '@/db/dbClient';
import { TokenRegistry, TokenRegistryRecord } from '@/db/xata';
import { AssetConfig } from '@/resources/web3/tokens';

// Pause integration for token registry until utility is reviewed again.
type SearchTokenRegistryParams = {
    blockchainNetwork?: SupportedChain;
    tokenSymbol?: string;
};

export const searchTokenRegistry = async (params: SearchTokenRegistryParams) => {
    const filters: Partial<SearchTokenRegistryParams> = {};

    if (params.blockchainNetwork) {
        filters['blockchainNetwork'] = params.blockchainNetwork;
    }
    if (params.tokenSymbol) {
        filters['tokenSymbol'] = params.tokenSymbol;
    }

    const records = await dbClient.token_registry.filter(filters).getAll();

    return records.map(normalizeTokenRegistryToAssetConfig);
};

export const getTokenRecordByTokenAddress = async (tokenAddress: string) => {
    const record = await dbClient.token_registry.filter({ tokenAddress }).getFirst();

    return record ? normalizeTokenRegistryToAssetConfig(record) : null;
};

export const getTokensByTokenSymbol = async (tokenSymbol: string) => {
    const records = await dbClient.token_registry.filter({ tokenSymbol }).getAll();

    return records.map(normalizeTokenRegistryToAssetConfig);
};

export const getTokensByBlockchainNetwork = async (blockchainNetwork: SupportedChain) => {
    const records = await dbClient.token_registry.filter({ blockchainNetwork }).getAll();

    return records.map(normalizeTokenRegistryToAssetConfig);
};

export const addTokenToRegistry = async (input: TokenRegistry) => {
    const { id, ...rest } = input;

    return await dbClient.token_registry.create(id, rest);
};

function normalizeTokenRegistryToAssetConfig(record: TokenRegistryRecord): AssetConfig {
    return {
        tokenName: record.tokenSymbol,
        listItemId: record.id,
        network: supportedChainSchema
            .or(extendedWalletSupportedNetworks)
            .parse(record.blockchainNetwork),
        showOnAssetsMenu: false,
        supportedAssetActions: [ExploreAssetActions.DEPOSIT, ExploreAssetActions.WITHDRAW_ASSET],
        tokenAddress: record.tokenAddress,
    };
}
