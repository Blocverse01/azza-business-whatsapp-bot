import {
    type AssetBalance,
    AssetSwapTransaction,
    type AssetTransaction,
    type BalanceQueryParams,
    BaseWalletProvider,
    type CreateUserWalletParams,
    type CreateUserWalletsParams,
    ExecuteAssetSwapParams,
    type SearchAssetParams,
    SwapAssetQuote,
    SwapAssetQuoteParams,
    type UserWallet,
    type WithdrawAssetParams,
} from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import { BlockradarTransactionType } from '@/app/Blockradar/schema';
import type { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import type { AssetConfig } from '@/resources/web3/core/tokens';

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

    public async getTransactionByHash(
        transactionHash: string,
        network: AllSupportedBlockchains,
        transactionType?: BlockradarTransactionType
    ): Promise<AssetTransaction> {
        return this.walletProvider.getTransactionByHash(transactionHash, network, transactionType);
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

    public searchAssets(searchParams: SearchAssetParams) {
        return this.walletProvider.searchAssets(searchParams);
    }

    public getWithdrawNetworkFee(
        params: Pick<WithdrawAssetParams, 'amount' | 'assetId' | 'userId' | 'recipient'>
    ): Promise<{ nativeBalance: number; networkFee: number }> {
        return this.walletProvider.getWithdrawNetworkFee(params);
    }

    public getSwapQuote(params: SwapAssetQuoteParams): Promise<SwapAssetQuote> {
        return this.walletProvider.getSwapQuote(params);
    }

    public executeAssetSwap(params: ExecuteAssetSwapParams): Promise<AssetSwapTransaction> {
        return this.walletProvider.executeAssetSwap(params);
    }
}

export default AzzaWalletManager;
