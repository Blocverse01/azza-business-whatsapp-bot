import ExtendedWallet from '@/app/ExtendedWallet/ExtendedWallet';
import {
    getDefaultSolanaNode,
    getSolanaNetworkClient,
    SolanaNode,
} from '@/app/ExtendedWallet/solana/config';
import {
    ExtendedWalletIdentity,
    ExtendedWalletSupportedNetworks,
    TransferTransactionResponse,
} from '@/app/ExtendedWallet/extendedWalletSchema';
import { Keypair, PublicKey } from '@solana/web3.js';
import { hexToUint8Array } from '@/Resources/utils/encoding';
import ExtendedSolanaWalletLibrary from '@/app/ExtendedWallet/solana/ExtendedSolanaWalletLibrary';

class ExtendedSolanaWallet extends ExtendedWallet {
    private readonly solanaNode: SolanaNode;

    public constructor(mnemonic: string, solanaNode: SolanaNode = getDefaultSolanaNode()) {
        super(mnemonic);
        this.solanaNode = solanaNode;
    }

    public get network(): Extract<ExtendedWalletSupportedNetworks, 'Solana'> {
        return 'Solana';
    }

    public get publicKey(): PublicKey {
        return this.keypair.publicKey;
    }

    public async getWalletNativeBalance(): Promise<number> {
        return ExtendedSolanaWalletLibrary.getWalletNativeBalance(
            this.solanaNetworkClient,
            this.keypair.publicKey
        );
    }

    public async getWalletTokenBalance(tokenAddress: string): Promise<number> {
        return ExtendedSolanaWalletLibrary.getWalletTokenBalance(
            this.solanaNetworkClient,
            new PublicKey(tokenAddress),
            this.keypair.publicKey
        );
    }

    public async getTransaction(transactionId: string) {
        return ExtendedSolanaWalletLibrary.getTransaction(this.solanaNetworkClient, transactionId);
    }

    public async transferNativeToken(
        amount: number,
        toAddress: string
    ): Promise<TransferTransactionResponse> {
        const transactionHash = await ExtendedSolanaWalletLibrary.transferNativeToken(
            this.solanaNetworkClient,
            amount,
            new PublicKey(toAddress),
            this.keypair
        );

        return {
            status: 'submitted',
            transactionHash,
        };
    }

    public async transferToken(
        tokenAddress: string,
        amount: number,
        toAddress: string
    ): Promise<TransferTransactionResponse> {
        const transactionHash = await ExtendedSolanaWalletLibrary.transferToken(
            this.solanaNetworkClient,
            new PublicKey(tokenAddress),
            amount,
            new PublicKey(toAddress),
            this.keypair
        );

        return {
            status: 'submitted',
            transactionHash,
        };
    }

    // Protected
    protected getWalletIdentity(): ExtendedWalletIdentity {
        return ExtendedSolanaWalletLibrary.getExtendedWalletIdentity(this.mnemonic);
    }

    // Private
    private get solanaNetworkClient() {
        return getSolanaNetworkClient(this.solanaNode);
    }
    private get keypair() {
        return Keypair.fromSecretKey(hexToUint8Array(this.privateKey));
    }
}

export default ExtendedSolanaWallet;
