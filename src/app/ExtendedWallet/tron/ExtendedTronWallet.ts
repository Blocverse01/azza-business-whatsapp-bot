import ExtendedWallet from '@/app/ExtendedWallet/ExtendedWallet';
import ExtendedTronWalletLibrary from '@/app/ExtendedWallet/tron/ExtendedTronWalletLibrary';
import {
    ExtendedWalletIdentity,
    ExtendedWalletSupportedNetworks,
    ExtendedWalletTransaction,
    TransferTransactionResponse,
} from '@/app/ExtendedWallet/extendedWalletSchema';
import {
    createPrivateTronWebClient,
    publicTronWebClient,
} from '@/app/ExtendedWallet/tron/tronNetworkClient';
import {
    createPrivateNodeConfig,
    getDefaultTronNode,
    TronNode,
} from '@/app/ExtendedWallet/tron/config';
import { TronWeb } from 'tronweb';
import { getTransactionExplorerUrl } from '@/resources/web3/explorerUrls';

class ExtendedTronWallet extends ExtendedWallet {
    private readonly tronNode: TronNode;
    // This is the private TronWeb client that is used to interact with the Tron blockchain for an ExtendedTronWallet instance. It is created using the private key of the wallet.
    // To ensure the wallet uses the tronNode provided in the constructor, the private TronWeb client is created in the constructor.
    private readonly privateTronWebClient: TronWeb;

    public constructor(mnemonic: string, tronNode: TronNode = getDefaultTronNode()) {
        super(mnemonic);
        this.tronNode = tronNode;
        this.privateTronWebClient = this.createPrivateTronWebClient();
    }

    protected getWalletIdentity(): ExtendedWalletIdentity {
        return ExtendedTronWalletLibrary.getExtendedWalletIdentity(
            // Use the public TronWeb client to generate the wallet identity, because it must have been initialised before the constructor.
            // Attempting to use the private TronWeb client would result in an error, as it has not been initialised yet.
            publicTronWebClient,
            this.mnemonic
        );
    }

    /**
     * Get network
     * @returns ExtendedWalletSupportedNetworks
     * @example const network = wallet.network;
     */
    public get network(): ExtendedWalletSupportedNetworks {
        return 'Tron';
    }

    /**
     * Get wallet native balance
     * @returns Promise<number>
     * @example const balance = await wallet.getWalletNativeBalance();
     */
    public async getWalletNativeBalance(): Promise<number> {
        return await ExtendedTronWalletLibrary.getWalletNativeBalance(
            this.privateTronWebClient,
            this.address
        );
    }

    /**
     * Get wallet token balance
     * @param tokenAddress
     * @returns Promise<number>
     * @example const balance = await wallet.getWalletTokenBalance(tokenAddress);
     */
    public async getWalletTokenBalance(tokenAddress: string): Promise<number> {
        return await ExtendedTronWalletLibrary.getWalletTokenBalance(
            this.privateTronWebClient,
            this.address,
            tokenAddress
        );
    }

    /**
     * Transfer token, returns transaction hash
     * @param amount
     * @param tokenAddress
     * @param toAddress
     * @returns Promise<string>
     * @example await wallet.transferToken(amount, tokenAddress, toAddress);
     */
    public async transferToken(
        tokenAddress: string,
        amount: number,
        toAddress: string
    ): Promise<TransferTransactionResponse> {
        const transactionHash = await ExtendedTronWalletLibrary.transferToken(
            this.privateTronWebClient,
            tokenAddress,
            amount,
            toAddress
        );

        return {
            status: 'submitted',
            transactionHash,
        };
    }

    public async transferNativeToken(
        amount: number,
        toAddress: string
    ): Promise<TransferTransactionResponse> {
        const response = await ExtendedTronWalletLibrary.transferNativeToken(
            this.privateTronWebClient,
            amount,
            toAddress
        );

        const transactionHash = response.transaction.txID;
        const submitted = response.result;

        return { status: submitted ? 'submitted' : 'failed', transactionHash };
    }

    public async getTransaction(transactionId: string): Promise<ExtendedWalletTransaction> {
        // Retrieve transaction information from the Tron blockchain using the transaction ID
        const transactionInfo = await ExtendedTronWalletLibrary.getTransactionInfoByHash(
            this.privateTronWebClient,
            transactionId
        );

        // Case 1: Transaction is unconfirmed or not found on-chain
        if (!transactionInfo || Object.keys(transactionInfo).length === 0) {
            return {
                transactionHash: transactionId,
                status: 'pending', // Status set to 'pending' since the transaction is not yet confirmed
                explorerUrl: getTransactionExplorerUrl(transactionId, 'Tron'),
            };
        }

        // Initialize default status as 'submitted'
        let status: ExtendedWalletTransaction['status'] = 'submitted';

        // Case 2: Transaction execution failed (e.g., contract interaction failed)
        if (transactionInfo.result === 'FAILED') {
            status = 'failed'; // Status set to 'failed' for failed transactions
        }
        // Case 3: Transaction execution reverted (e.g., contract reverted due to failure in execution)
        else if (transactionInfo.receipt?.result === 'REVERT') {
            status = 'reverted'; // Status set to 'reverted' if the transaction was reverted on-chain
        }
        // Case 4: Contract execution was successful
        else if (
            transactionInfo.receipt?.result === 'SUCCESS' &&
            transactionInfo.result === undefined
        ) {
            status = 'success'; // Status set to 'success' for successful contract interactions
        }
        // Case 5: Native transfer (e.g., transferring TRX) was successful
        else if (
            transactionInfo.contractResult &&
            transactionInfo.contractResult[0] === '' &&
            transactionInfo.receipt?.net_fee
        ) {
            status = 'success'; // Status set to 'success' for successful native transactions
        }

        // Return the transaction information with the determined status
        return {
            transactionHash: transactionInfo.id,
            status: status, // Final status determined by the cases above
            explorerUrl: getTransactionExplorerUrl(transactionId, 'Tron'),
        };
    }

    public get privateKey(): string {
        // Remove 0x from the private key if it exists
        return this.walletIdentity.privateKey.replace('0x', '');
    }

    /**
     * Create private TronWeb client
     * @private
     * @returns TronWeb
     */
    private createPrivateTronWebClient() {
        const config = createPrivateNodeConfig(this.tronNode, this.privateKey);

        return createPrivateTronWebClient(config);
    }
}

export default ExtendedTronWallet;
