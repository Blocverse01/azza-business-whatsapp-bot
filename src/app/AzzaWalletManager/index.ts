import {
    type AssetBalance,
    type AssetTransaction,
    type BalanceQueryParams,
    BaseWalletProvider,
    type CreateUserWalletParams,
    type CreateUserWalletsParams,
    type UserWallet,
    type WithdrawAssetParams,
} from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import type { AllSupportedBlockchains } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import type { AssetConfig } from '@/resources/web3/tokens';

class AzzaWalletManager implements BaseWalletProvider {
    private readonly walletProvider: BaseWalletProvider;

    constructor(provider: BaseWalletProvider) {
        this.walletProvider = provider;
    }

    public async getAssetBalance(params: BalanceQueryParams): Promise<AssetBalance> {
        return this.walletProvider.getAssetBalance(params);
    }

    public async getNetworkBalances(
        userId: string,
        network: AllSupportedBlockchains
    ): Promise<Array<AssetBalance>> {
        return this.walletProvider.getNetworkBalances(userId, network);
    }

    public async getUserWallet(
        userId: string,
        network: AllSupportedBlockchains
    ): Promise<UserWallet> {
        return this.walletProvider.getUserWallet(userId, network);
    }

    public async getTransaction(
        transactionId: string,
        network: AllSupportedBlockchains
    ): Promise<AssetTransaction> {
        return this.walletProvider.getTransaction(transactionId, network);
    }

    public async withdrawAsset(params: WithdrawAssetParams): Promise<AssetTransaction> {
        return this.walletProvider.withdrawAsset(params);
    }

    public async createUserWallet(params: CreateUserWalletParams): Promise<UserWallet> {
        return this.walletProvider.createUserWallet(params);
    }

    public async createUserWallets(params: CreateUserWalletsParams): Promise<Array<UserWallet>> {
        return this.walletProvider.createUserWallets(params);
    }

    public getSupportedAssets(): Array<AssetConfig> {
        return this.walletProvider.getSupportedAssets();
    }

    public getSupportedNetworks(): Array<AllSupportedBlockchains> {
        return this.walletProvider.getSupportedNetworks();
    }

    public searchAssets(
        searchParams: Partial<Pick<AssetConfig, 'network' | 'tokenName' | 'tokenAddress'>>
    ) {
        return this.walletProvider.searchAssets(searchParams);
    }
}

export default AzzaWalletManager;
