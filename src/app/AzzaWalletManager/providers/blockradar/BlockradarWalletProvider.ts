import type {
    AssetBalance,
    AssetTransaction,
    BalanceQueryParams,
    BaseWalletProvider,
    CreateUserWalletParams,
    CreateUserWalletsParams,
    UserWallet,
    WithdrawAssetParams,
} from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import { BlockradarWalletProviderError } from '@/app/AzzaWalletManager/providers/blockradar/resources/errors';
import type BlockradarMasterWalletApiClient from '@/app/Blockradar/BlockradarMasterWalletApiClient';
import { delay } from '@/resources/utils/delay';
import {
    AllSupportedBlockchains,
    EvmCompatibleBlockchain,
} from '@/resources/web3/core/blockchains';
import type { AssetConfig } from '@/resources/web3/core/tokens';
import type { Logtail } from '@logtail/node';
import { BlockradarTransactionType } from '@/app/Blockradar/schema';

type BlockradarWalletProviderParams = {
    dataSources: {
        platformAssetConfigs: () => Array<AssetConfig>;
        blockradarAssetId: (platformAssetId: string) => string;
        platformAssetId: (blockradarAssetId: string) => string | null;
        blockradarMasterWalletClient: (
            blockchain: AllSupportedBlockchains
        ) => BlockradarMasterWalletApiClient;
        userAddressId: (userId: string, network: AllSupportedBlockchains) => Promise<string | null>;
        supportedNetworks: () => Array<AllSupportedBlockchains>;
        syncUserAddress?: (params: {
            userId: string;
            network: AllSupportedBlockchains;
            addressId: string;
            address: string;
        }) => Promise<unknown>;
    };
    networkUtils: {
        isEvmCompatibleBlockchain: (
            network: AllSupportedBlockchains
        ) => network is EvmCompatibleBlockchain;
    };
    logger?: Logtail;
};

class BlockradarWalletProvider implements BaseWalletProvider {
    private readonly dataSources: BlockradarWalletProviderParams['dataSources'];
    private readonly networkUtils: BlockradarWalletProviderParams['networkUtils'];
    private readonly logger: BlockradarWalletProviderParams['logger'];

    constructor(params: BlockradarWalletProviderParams) {
        this.dataSources = params.dataSources;
        this.networkUtils = params.networkUtils;
        this.logger = params.logger;
    }

    public async getAssetBalance(params: BalanceQueryParams): Promise<AssetBalance> {
        const assetConfig = this.getAssetConfig(params.assetId);
        const blockradarAssetId = this.dataSources.blockradarAssetId(params.assetId);

        const walletClient = this.dataSources.blockradarMasterWalletClient(assetConfig.network);
        const userAddressId = await this.gracefullyGetUserAddressId(
            params.userId,
            assetConfig.network
        );

        if (!userAddressId) {
            throw new BlockradarWalletProviderError({
                data: params,
                message: `User address ID does not exist`,
            });
        }

        const assetBalance = await walletClient.getBalance(userAddressId, blockradarAssetId);

        return {
            asset: assetConfig,
            balance: Number(assetBalance.balance),
            blockchainNetwork: assetConfig.network,
            convertedBalanceUsd: Number(assetBalance.convertedBalance),
        };
    }

    public async getNetworkBalances(
        userId: string,
        network: AllSupportedBlockchains
    ): Promise<Array<AssetBalance>> {
        const allNetworkAssets = this.dataSources
            .platformAssetConfigs()
            .filter((config) => config.network === network);
        const userAddressId = await this.gracefullyGetUserAddressId(userId, network);

        if (!userAddressId) {
            throw new BlockradarWalletProviderError({
                data: {
                    userId,
                    network,
                },
                message: `User address ID does not exist`,
            });
        }

        const walletClient = this.dataSources.blockradarMasterWalletClient(network);
        const assetBalances = await walletClient.getBalances(userAddressId);

        return allNetworkAssets
            .map((assetConfig) => {
                const balance = assetBalances.find(
                    (balance) =>
                        balance.asset.asset.symbol.toLowerCase() ===
                        assetConfig.tokenName.toLowerCase()
                );

                if (!balance) {
                    return;
                }

                return {
                    asset: assetConfig,
                    balance: Number(balance.balance),
                    blockchainNetwork: network,
                    convertedBalanceUsd: Number(balance.convertedBalance),
                };
            })
            .filter((balance) => balance !== undefined);
    }

    public async getUserWallet(
        userId: string,
        network: AllSupportedBlockchains
    ): Promise<UserWallet> {
        const walletClient = this.dataSources.blockradarMasterWalletClient(network);

        const addressId = await this.gracefullyGetUserAddressId(userId, network);
        if (!addressId) {
            throw new BlockradarWalletProviderError({
                data: {
                    userId,
                    network,
                },
                message: `User address ID does not exist`,
            });
        }

        const blockradarAddress = await walletClient.getAddress(addressId);

        return {
            name: blockradarAddress.name,
            address: blockradarAddress.address,
            blockchainNetwork: network,
            userId: userId,
            id: blockradarAddress.id,
        };
    }

    public async getTransaction(
        transactionId: string,
        network: AllSupportedBlockchains
    ): Promise<AssetTransaction> {
        const walletClient = this.dataSources.blockradarMasterWalletClient(network);
        const blockradarTransaction = await walletClient.getTransaction(transactionId);

        const assetConfig = this.searchAssets({
            tokenName: blockradarTransaction.asset.symbol,
            network,
        })[0];

        if (!assetConfig) {
            throw new BlockradarWalletProviderError({
                message: 'No asset config found for asset in transaction',
                data: {
                    transaction: blockradarTransaction,
                    transactionId,
                    network,
                },
            });
        }

        return {
            asset: assetConfig,
            amount: blockradarTransaction.amount,
            blockchainNetwork: network,
            confirmations: blockradarTransaction.confirmations,
            confirmed: blockradarTransaction.confirmed,
            status: blockradarTransaction.status,
            hash: blockradarTransaction.hash,
            recipientAddress: blockradarTransaction.recipientAddress,
            senderAddress: blockradarTransaction.senderAddress,
            id: blockradarTransaction.id,
            reference: blockradarTransaction.reference,
        };
    }

    public async getTransactionByHash(
        transactionHash: string,
        network: AllSupportedBlockchains,
        targetTransactionType?: BlockradarTransactionType
    ): Promise<AssetTransaction> {
        const walletClient = this.dataSources.blockradarMasterWalletClient(network);
        const blockradarTransaction = await walletClient.getTransactionByHash(
            transactionHash,
            targetTransactionType
        );

        if (!blockradarTransaction) {
            throw new BlockradarWalletProviderError({
                message: 'No transaction found for hash',
                data: {
                    transactionHash,
                    network,
                },
            });
        }

        const assetConfig = this.searchAssets({
            tokenName: blockradarTransaction.asset.symbol,
            network,
        })[0];

        if (!assetConfig) {
            throw new BlockradarWalletProviderError({
                message: 'No asset config found for asset in transaction',
                data: {
                    transaction: blockradarTransaction,
                    transactionHash,
                    network,
                },
            });
        }

        return {
            asset: assetConfig,
            amount: blockradarTransaction.amount,
            blockchainNetwork: network,
            confirmations: blockradarTransaction.confirmations,
            confirmed: blockradarTransaction.confirmed,
            status: blockradarTransaction.status,
            hash: blockradarTransaction.hash,
            recipientAddress: blockradarTransaction.recipientAddress,
            senderAddress: blockradarTransaction.senderAddress,
            id: blockradarTransaction.id,
            reference: blockradarTransaction.reference,
        };
    }

    public async withdrawAsset(params: WithdrawAssetParams): Promise<AssetTransaction> {
        const assetConfig = this.getAssetConfig(params.assetId);
        const blockradarAssetId = this.dataSources.blockradarAssetId(params.assetId);
        const walletClient = this.dataSources.blockradarMasterWalletClient(assetConfig.network);

        const userAddressId = await this.gracefullyGetUserAddressId(
            params.userId,
            assetConfig.network
        );

        if (!userAddressId) {
            throw new BlockradarWalletProviderError({
                data: {
                    userId: params.userId,
                    network: assetConfig.network,
                },
                message: `User address ID does not exist`,
            });
        }

        const withdrawTransaction = await walletClient.withdraw(userAddressId, {
            amount: params.amount,
            address: params.recipient,
            assetId: blockradarAssetId,
            reference: params.reference,
            metadata: params.metadata,
        });

        return {
            asset: assetConfig,
            amount: withdrawTransaction.amount,
            blockchainNetwork: assetConfig.network,
            confirmations: withdrawTransaction.confirmations,
            confirmed: withdrawTransaction.confirmed,
            status: withdrawTransaction.status,
            hash: withdrawTransaction.hash,
            recipientAddress: withdrawTransaction.recipientAddress,
            senderAddress: withdrawTransaction.senderAddress,
            id: withdrawTransaction.id,
        };
    }

    public async createUserWallet(params: CreateUserWalletParams): Promise<UserWallet> {
        const walletClient = this.dataSources.blockradarMasterWalletClient(params.network);

        const address = await walletClient.generateAddress({
            disableAutoSweep: true,
            enableGaslessWithdraw: true,
            metadata: {
                userId: params.userId,
            },
        });

        return {
            name: address.name,
            address: address.address,
            blockchainNetwork: params.network,
            userId: params.userId,
            id: address.id,
        };
    }

    public async createUserWallets(params: CreateUserWalletsParams): Promise<Array<UserWallet>> {
        const createWalletPromises: Array<Promise<UserWallet>> = [];
        const settledCreateWalletPromises: Array<UserWallet> = [];
        const failedCreateWalletPromises: Array<unknown> = [];

        const evmNetworks = params.networks.filter((network) =>
            this.networkUtils.isEvmCompatibleBlockchain(network)
        );

        if (params.shouldMapEvmAddresses && evmNetworks.length > 0) {
            const randomEvmNetwork = evmNetworks[0];
            createWalletPromises.push(
                this.createUserWallet({
                    userId: params.userId,
                    network: randomEvmNetwork,
                })
            );
        }

        const otherNetworks = params.networks.filter(
            (network) => !this.networkUtils.isEvmCompatibleBlockchain(network)
        );

        otherNetworks.forEach((network) => {
            createWalletPromises.push(
                this.createUserWallet({
                    userId: params.userId,
                    network,
                })
            );
        });

        const userWalletsCreated = await Promise.allSettled(createWalletPromises);
        userWalletsCreated.forEach((settledPromise) => {
            if (settledPromise.status === 'fulfilled') {
                settledCreateWalletPromises.push(settledPromise.value);
            } else {
                failedCreateWalletPromises.push(settledPromise.reason);
            }
        });

        if (failedCreateWalletPromises.length > 0) {
            console.error('Failed to create user wallets', {
                userId: params.userId,
                failedCreateWalletPromises,
            });
        }

        const createdEvmWallet = settledCreateWalletPromises.find((wallet) =>
            this.networkUtils.isEvmCompatibleBlockchain(wallet.blockchainNetwork)
        );

        return params.networks
            .map((network) => {
                if (this.networkUtils.isEvmCompatibleBlockchain(network) && createdEvmWallet) {
                    return {
                        ...createdEvmWallet,
                        blockchainNetwork: network,
                    };
                }

                return settledCreateWalletPromises.find(
                    (wallet) => wallet.blockchainNetwork === network
                );
            })
            .filter((wallet) => wallet !== undefined);
    }

    public getSupportedAssets(): Array<AssetConfig> {
        return this.dataSources.platformAssetConfigs();
    }

    public getSupportedNetworks(): Array<AllSupportedBlockchains> {
        return this.dataSources.supportedNetworks();
    }

    private getAssetConfig(assetId: string) {
        const config = this.getSupportedAssets().find(
            (assetConfig) => assetConfig.listItemId.toLowerCase() === assetId.toLowerCase()
        );

        if (!config) {
            throw new BlockradarWalletProviderError({
                message: `Asset config not found for asset ID`,
                data: { assetId },
            });
        }

        return config;
    }

    public searchAssets(searchParams: Partial<Pick<AssetConfig, 'network' | 'tokenName'>>) {
        return this.getSupportedAssets().filter((asset) => {
            return Object.entries(searchParams).every(([key, value]) => {
                const typedKey = key as keyof Partial<Pick<AssetConfig, 'network' | 'tokenName'>>;
                return asset[typedKey].toLowerCase() === value.toLowerCase();
            });
        });
    }

    public async gracefullyGetUserAddressId(
        userId: string,
        blockchainNetwork: AllSupportedBlockchains,
        retryCount: number = 0
    ): Promise<string | null> {
        const maxRetries = 5;
        const baseDelay = 5000; // Start with 5s delay

        // Attempt to check our records
        const addressId = await this.dataSources.userAddressId(userId, blockchainNetwork);
        if (addressId) return addressId;

        // Attempt to check on provider's side
        const walletClient = this.dataSources.blockradarMasterWalletClient(blockchainNetwork);

        const searchedAddress = await walletClient.searchAddressByMetadata({ userId });

        if (searchedAddress) {
            if (this.dataSources.syncUserAddress) {
                await this.dataSources.syncUserAddress({
                    userId,
                    network: blockchainNetwork,
                    addressId: searchedAddress.id,
                    address: searchedAddress.address,
                });
            }
            return searchedAddress.id;
        }

        // Try to create the user wallet
        try {
            await this.createUserWallet({ userId, network: blockchainNetwork });
        } catch (error) {
            // Handle error
        }

        // Stop retrying after max retries
        if (retryCount >= maxRetries) return null;

        const delayTime = baseDelay * 2 ** retryCount; // Exponential backoff
        await delay(delayTime);

        return this.gracefullyGetUserAddressId(userId, blockchainNetwork, retryCount + 1);
    }
}

export default BlockradarWalletProvider;
