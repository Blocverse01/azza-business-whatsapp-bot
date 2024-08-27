import {
    ExtendedWalletIdentity,
    extendedWalletIdentitySchema,
} from '@/app/ExtendedWallet/extendedWalletSchema';
import { BigNumber, TronWeb } from 'tronweb';
import { formatUnits, parseUnits } from 'viem';
import { BroadcastReturn, SignedTransaction } from 'tronweb/lib/commonjs/types';

class ExtendedTronWalletLibrary {
    /**
     * Get Extended Wallet Identity
     * @param tronClient
     * @param mnemonic
     * @returns ExtendedWalletIdentity
     * @throws Error
     * @throws ValidationError
     * @example ExtendedTronWalletLibrary.getExtendedWalletIdentity(tronClient, mnemonic);
     **/
    public static getExtendedWalletIdentity(
        tronClient: TronWeb,
        mnemonic: string
    ): ExtendedWalletIdentity {
        const tronWallet = tronClient.fromMnemonic(mnemonic);

        return extendedWalletIdentitySchema.parse({
            privateKey: tronWallet.privateKey,
            address: tronWallet.address,
        });
    }

    /**
     * Get Wallet Native Balance
     * @param tronClient
     * @param address
     * @returns Promise<number>
     * @example const balance = await ExtendedTronWalletLibrary.getWalletNativeBalance(tronClient, address);
     **/
    public static async getWalletNativeBalance(
        tronClient: TronWeb,
        address: string
    ): Promise<number> {
        const rawBalance = await tronClient.trx.getBalance(address);

        return Number(tronClient.fromSun(rawBalance));
    }

    /**
     * Get Wallet Token Balance
     * @param tronClient
     * @param address
     * @param tokenAddress
     * @returns Promise<number>
     * @example const balance = await ExtendedTronWalletLibrary.getWalletTokenBalance(tronClient, address, tokenAddress);
     */
    public static async getWalletTokenBalance(
        tronClient: TronWeb,
        address: string,
        tokenAddress: string
    ): Promise<number> {
        const contract = await tronClient.contract().at(tokenAddress);
        tronClient.setAddress(address); // This is a workaround for this issue: https://github.com/tronprotocol/tronweb/issues/90

        const [decimals, balance] = await Promise.all([
            this.getTokenDecimals(tronClient, tokenAddress),
            contract.methods.balanceOf(address).call(),
        ]);

        return Number(formatUnits(balance as unknown as bigint, decimals));
    }

    /**
     * Transfer Native Token (TRX) to Address
     * @param privateTronClient
     * @param amount
     * @param toAddress
     */
    public static async transferNativeToken(
        privateTronClient: TronWeb,
        amount: number,
        toAddress: string
    ): Promise<BroadcastReturn<SignedTransaction>> {
        if (!privateTronClient.isAddress(toAddress)) {
            throw new Error('Invalid recipient address');
        }

        const amountInSun = privateTronClient.toSun(amount);

        return await privateTronClient.trx.sendTransaction(
            toAddress,
            Number(amountInSun.toString())
        );
    }

    /**
     * Transfer Token to Address
     * @param privateTronClient
     * @param tokenAddress
     * @param amount
     * @param toAddress
     * @returns Promise<unknown>
     * @example await ExtendedTronWalletLibrary.transferToken(privateTronClient, amount, tokenAddress, toAddress);
     */
    public static async transferToken(
        privateTronClient: TronWeb,
        tokenAddress: string,
        amount: number,
        toAddress: string
    ): Promise<string> {
        if (!privateTronClient.isAddress(toAddress)) {
            throw new Error('Invalid recipient address');
        }

        const [contract, tokenDecimals] = await Promise.all([
            privateTronClient.contract().at(tokenAddress),
            ExtendedTronWalletLibrary.getTokenDecimals(privateTronClient, tokenAddress),
        ]);

        const bigAmount = parseUnits(`${amount}`, tokenDecimals);

        return await contract.methods.transfer(toAddress, bigAmount).send();
    }

    /**
     * Get Transaction Info By Hash
     * @param tronClient
     * @param hash
     */
    public static async getTransactionInfoByHash(tronClient: TronWeb, hash: string) {
        return await tronClient.trx.getTransactionInfo(hash);
    }

    /**
     * Get Token Decimals
     * @param tronClient
     * @param tokenAddress
     */
    public static async getTokenDecimals(
        tronClient: TronWeb,
        tokenAddress: string
    ): Promise<number> {
        const contract = await tronClient.contract().at(tokenAddress);
        const decimals = await contract.methods.decimals().call();

        return tronClient.toDecimal(decimals as unknown as BigNumber);
    }

    /**
     * Get Confirmed Transaction Info By Hash
     * @param tronClient
     * @param hash
     */
    public static async getConfirmedTransactionInfoByHash(tronClient: TronWeb, hash: string) {
        return await tronClient.trx.getConfirmedTransaction(hash);
    }

    /**
     * Get Unconfirmed Transaction Info By Hash
     * @param tronClient
     * @param hash
     */
    public static async getUnconfirmedTransactionInfoByHash(tronClient: TronWeb, hash: string) {
        return await tronClient.trx.getUnconfirmedTransactionInfo(hash);
    }
}

export default ExtendedTronWalletLibrary;
