import type { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import type { AssetConfig } from '@/resources/web3/core/tokens';

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
    confirmations?: number | null;
    confirmed: boolean;
    status: 'PENDING' | 'FAILED' | 'SUCCESS';
    hash?: string | null;
    recipientAddress: string;
    senderAddress: string;
    id: string;
    reference?: string | null;
};
export type WithdrawAssetParams = {
    assetId: string;
    userId: string;
    amount: string;
    recipient: string;
    reference?: string;
    metadata?: Record<string, unknown>;
};
export type SearchAssetParams = Partial<{
    network: string;
    tokenName: string;
    tokenAddress: string;
}>;
export type SwapAssetQuoteParams = {
    fromAssetId: string;
    toAssetId: string;
    amount: string;
    recipientAddress?: string;
    userId: string;
};
export type SwapAssetQuote = {
    amount: number;
    rate: number;
    estimatedArrivalTime: number; // in seconds
    networkFee: number; // in native asset
};
export type ExecuteAssetSwapParams = {
    fromAssetId: string;
    toAssetId: string;
    fromAmount: string;
    recipientAddress: string;
    reference: string;
    metadata?: Record<string, string>;
    userId: string;
};
export type AssetSwapTransaction = {
    fromAsset: AssetConfig;
    toAsset: AssetConfig;
    fromAmount: number;
    toAmount: number;
    rate: number;
    reference: string;
    confirmed: boolean;
    status: 'PENDING' | 'FAILED' | 'SUCCESS';
    hash?: string | null;
    id: string;
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

    public abstract getWithdrawNetworkFee(
        params: Pick<WithdrawAssetParams, 'amount' | 'assetId' | 'userId' | 'recipient'>
    ): Promise<{
        nativeBalance: number;
        networkFee: number;
    }>;

    public abstract getSwapQuote(params: SwapAssetQuoteParams): Promise<SwapAssetQuote>;

    public abstract executeAssetSwap(params: ExecuteAssetSwapParams): Promise<AssetSwapTransaction>;

    public abstract searchAssets(searchParams: SearchAssetParams): Array<AssetConfig>;
}
