import { AllSupportedBlockchains } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import { AssetConfig } from '@/resources/web3/tokens';

export type BalanceQueryParams = {
    assetId: string;
    userId: string;
};
export type CreateUserWalletsParams = {
    userId: string;
    networks: Array<AllSupportedBlockchains>;
    shouldMapEvmAddresses?: boolean;
};
export type CreateUserWalletParams = {
    userId: string;
    network: AllSupportedBlockchains;
};
export type UserWallet = {
    address: string;
    blockchainNetwork: AllSupportedBlockchains;
    userId: string;
    name: string | null;
    id: string;
};
export type AssetBalance = {
    blockchainNetwork: AllSupportedBlockchains;
    balance: number;
    convertedBalanceUsd?: number;
    asset: AssetConfig;
};
export type AssetTransaction = {
    amount: string;
    asset: AssetConfig;
    blockchainNetwork: AllSupportedBlockchains;
    confirmations: number | null;
    confirmed: boolean;
    status: 'PENDING' | 'FAILED' | 'SUCCESS';
    hash: string | null;
    recipientAddress: string;
    senderAddress: string;
    id: string;
};
export type WithdrawAssetParams = {
    assetId: string;
    userId: string;
    amount: string;
    recipient: string;
    reference?: string;
};

export abstract class BaseWalletProvider {
    public abstract getAssetBalance(params: BalanceQueryParams): Promise<AssetBalance>;

    public abstract createUserWallets(params: CreateUserWalletsParams): Promise<Array<UserWallet>>;

    public abstract createUserWallet(params: CreateUserWalletParams): Promise<UserWallet>;

    public abstract getUserWallet(
        userId: string,
        network: AllSupportedBlockchains
    ): Promise<UserWallet>;

    public abstract getNetworkBalances(
        userId: string,
        network: AllSupportedBlockchains
    ): Promise<Array<AssetBalance>>;

    public abstract getSupportedAssets(): Array<AssetConfig>;

    public abstract getSupportedNetworks(): Array<AllSupportedBlockchains>;

    public abstract getTransaction(
        transactionId: string,
        network: AllSupportedBlockchains
    ): Promise<AssetTransaction>;

    public abstract getTransactionByHash(
        transactionHash: string,
        network: AllSupportedBlockchains
    ): Promise<AssetTransaction>;

    public abstract withdrawAsset(params: WithdrawAssetParams): Promise<AssetTransaction>;

    public abstract searchAssets(
        searchParams: Partial<Pick<AssetConfig, 'network' | 'tokenName'>>
    ): Array<AssetConfig>;
}
