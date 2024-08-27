import {
    ExtendedWalletIdentity,
    ExtendedWalletSupportedNetworks,
    ExtendedWalletTransaction,
    TransferTransactionResponse,
} from '@/app/ExtendedWallet/extendedWalletSchema';

abstract class ExtendedWallet {
    protected readonly mnemonic: string;
    protected readonly walletIdentity: ExtendedWalletIdentity;

    /**
     * Create an instance of ExtendedWallet
     * @param mnemonic
     * @example const wallet = new ExtendedWallet(mnemonic);
     **/
    protected constructor(mnemonic: string) {
        this.mnemonic = mnemonic;
        this.walletIdentity = this.getWalletIdentity();
    }

    /**
     * Get the wallet address of the wallet
     * @returns string
     * @example const address = wallet.address;
     */
    public get address(): string {
        return this.walletIdentity.address;
    }

    /**
     * Get the private key of the wallet
     * @returns string
     * @example const privateKey = wallet.privateKey;
     */
    public get privateKey(): string {
        return this.walletIdentity.privateKey;
    }

    protected abstract getWalletIdentity(): ExtendedWalletIdentity;

    public abstract get network(): ExtendedWalletSupportedNetworks;
    public abstract getWalletNativeBalance(): Promise<number>;
    public abstract getWalletTokenBalance(tokenAddress: string): Promise<number>;
    public abstract getTransaction(transactionId: string): Promise<ExtendedWalletTransaction>;
    public abstract transferNativeToken(
        amount: number,
        toAddress: string
    ): Promise<TransferTransactionResponse>;
    public abstract transferToken(
        tokenAddress: string,
        amount: number,
        toAddress: string
    ): Promise<TransferTransactionResponse>;
}

export default ExtendedWallet;
