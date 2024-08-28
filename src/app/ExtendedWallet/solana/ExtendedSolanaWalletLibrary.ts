import {
    ExtendedWalletIdentity,
    extendedWalletIdentitySchema,
    ExtendedWalletTransaction,
} from '@/app/ExtendedWallet/extendedWalletSchema';
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    ParsedAccountData,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import { uint8ArrayToHex } from '@/Resources/utils/encoding';
import {
    CONFIRMED_COMMITMENT,
    TOKEN_PROGRAM_ID,
    WALLET_DERIVATION_PATH,
} from '@/app/ExtendedWallet/solana/config';
import { ZERO } from '@/constants/numbers';
import { AccountLayout } from '@/app/ExtendedWallet/solana/layouts';
import { formatUnits, parseUnits } from 'viem';
import { getTransactionExplorerUrl } from '@/Resources/web3/explorerUrls';
import {
    getAssociatedTokenAddress,
    createTransferCheckedInstruction,
    createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

class ExtendedSolanaWalletLibrary {
    public static getExtendedWalletIdentity(mnemonic: string): ExtendedWalletIdentity {
        const seed = mnemonicToSeedSync(mnemonic);
        const seedString = Buffer.from(seed).toString('hex');

        const derivedSeed = derivePath(WALLET_DERIVATION_PATH, seedString).key;
        const keypair = Keypair.fromSeed(derivedSeed);

        const address = keypair.publicKey.toBase58();
        const privateKey = uint8ArrayToHex(keypair.secretKey);

        return extendedWalletIdentitySchema.parse({
            privateKey: privateKey,
            address: address,
        });
    }

    public static async getWalletNativeBalance(
        solanaNetworkClient: Connection,
        publicKey: PublicKey
    ): Promise<number> {
        const balance = await solanaNetworkClient.getBalance(publicKey, CONFIRMED_COMMITMENT);

        return balance / LAMPORTS_PER_SOL;
    }

    public static async getWalletTokenBalance(
        solanaNetworkClient: Connection,
        tokenMintPublicKey: PublicKey,
        ownerPublicKey: PublicKey
    ): Promise<number> {
        const [tokenAccount, tokenDecimals] = await Promise.all([
            this.getTokenAccount(solanaNetworkClient, tokenMintPublicKey, ownerPublicKey),
            this.getTokenDecimals(solanaNetworkClient, tokenMintPublicKey),
        ]);

        if (!tokenAccount) return ZERO;

        const deserializedData = AccountLayout.decode(tokenAccount.account.data);

        return Number(formatUnits(deserializedData.amount, tokenDecimals));
    }

    public static async getTransaction(
        solanaNetworkClient: Connection,
        transactionHash: string
    ): Promise<ExtendedWalletTransaction> {
        const transaction = await solanaNetworkClient.getTransaction(transactionHash, {
            commitment: CONFIRMED_COMMITMENT,
            maxSupportedTransactionVersion: ZERO,
        });

        console.log({ transaction });

        let status: ExtendedWalletTransaction['status'] = 'pending';
        const explorerUrl = getTransactionExplorerUrl(transactionHash, 'Solana');

        if (!transaction) {
            return {
                status,
                explorerUrl,
                transactionHash: transactionHash,
            };
        }

        const transactionError = transaction.meta?.err;

        if (transactionError) {
            status = 'failed';
        }

        if (!transactionError && transaction.transaction.signatures.length > 0) {
            status = 'success';
        }

        return {
            status,
            explorerUrl,
            transactionHash,
        };
    }

    public static async transferNativeToken(
        solanaNetworkClient: Connection,
        amount: number,
        toPublicKey: PublicKey,
        fromKeypair: Keypair
    ): Promise<string> {
        // Create transfer instruction
        const transferInstruction = SystemProgram.transfer({
            fromPubkey: fromKeypair.publicKey,
            toPubkey: toPublicKey,
            lamports: BigInt(amount * LAMPORTS_PER_SOL), // amount in lamports (1 SOL = 1e9 lamports)
        });

        // Create a VersionedTransaction
        const transactionMessage = new TransactionMessage({
            payerKey: fromKeypair.publicKey,
            recentBlockhash: (await solanaNetworkClient.getLatestBlockhash()).blockhash,
            instructions: [transferInstruction],
        }).compileToV0Message(); // Compile to a Version 0 Message

        const versionedTransaction = new VersionedTransaction(transactionMessage);

        // Sign the transaction
        versionedTransaction.sign([fromKeypair]);

        // Send the transaction
        return await solanaNetworkClient.sendTransaction(versionedTransaction, {
            skipPreflight: false,
            preflightCommitment: CONFIRMED_COMMITMENT,
        });
    }

    public static async transferToken(
        solanaNetworkClient: Connection,
        tokenMintPublicKey: PublicKey,
        amount: number,
        toPublicKey: PublicKey,
        fromKeypair: Keypair
    ): Promise<string> {
        const [tokenAccount, tokenDecimals] = await Promise.all([
            this.getTokenAccount(solanaNetworkClient, tokenMintPublicKey, fromKeypair.publicKey),
            this.getTokenDecimals(solanaNetworkClient, tokenMintPublicKey),
        ]);

        if (!tokenAccount) {
            throw new Error('Token account not found');
        }

        const instructions: TransactionInstruction[] = [];

        const receiverTokenAccount = await this.getTokenAccountPublicKey(
            solanaNetworkClient,
            tokenMintPublicKey,
            toPublicKey
        );

        if (receiverTokenAccount.shouldCreate) {
            const instruction = createAssociatedTokenAccountInstruction(
                fromKeypair.publicKey, // payer
                receiverTokenAccount.publicKey, // ata
                toPublicKey, // owner
                tokenMintPublicKey // mint
            );

            instructions.push(instruction);
        }

        const transferInstruction = createTransferCheckedInstruction(
            tokenAccount.pubkey,
            tokenMintPublicKey,
            receiverTokenAccount.publicKey,
            fromKeypair.publicKey,
            parseUnits(`${amount}`, tokenDecimals),
            tokenDecimals
        );

        instructions.push(transferInstruction);

        const transactionMessage = new TransactionMessage({
            payerKey: fromKeypair.publicKey,
            recentBlockhash: (await solanaNetworkClient.getLatestBlockhash()).blockhash,
            instructions: instructions,
        }).compileToV0Message();

        const versionedTransaction = new VersionedTransaction(transactionMessage);

        versionedTransaction.sign([fromKeypair]);

        return await solanaNetworkClient.sendTransaction(versionedTransaction, {
            skipPreflight: false,
            preflightCommitment: CONFIRMED_COMMITMENT,
        });
    }

    private static async getTokenAccountPublicKey(
        solanaNetworkClient: Connection,
        tokenMintPublicKey: PublicKey,
        ownerPublicKey: PublicKey
    ): Promise<{
        publicKey: PublicKey;
        shouldCreate: boolean;
    }> {
        const tokenAccount = await this.getTokenAccount(
            solanaNetworkClient,
            tokenMintPublicKey,
            ownerPublicKey
        );

        if (tokenAccount) {
            return {
                publicKey: tokenAccount.pubkey,
                shouldCreate: false,
            };
        }

        return {
            publicKey: await getAssociatedTokenAddress(tokenMintPublicKey, ownerPublicKey, false),
            shouldCreate: true,
        };
    }
    private static async getTokenAccount(
        solanaNetworkClient: Connection,
        tokenMintPublicKey: PublicKey,
        ownerPublicKey: PublicKey
    ) {
        const tokenAccounts = await solanaNetworkClient.getTokenAccountsByOwner(ownerPublicKey, {
            mint: tokenMintPublicKey,
            programId: TOKEN_PROGRAM_ID,
        });

        if (tokenAccounts.value[0]) {
            return tokenAccounts.value[0];
        }

        return null;
    }
    private static async getTokenDecimals(
        solanaNetworkClient: Connection,
        tokenMintPublicKey: PublicKey
    ): Promise<number> {
        const info = await solanaNetworkClient.getParsedAccountInfo(tokenMintPublicKey);

        return (
            info.value?.data as ParsedAccountData & {
                parsed: {
                    info: {
                        decimals: number;
                    };
                };
            }
        ).parsed.info.decimals;
    }
}

export default ExtendedSolanaWalletLibrary;
