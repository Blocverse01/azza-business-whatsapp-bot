import {
    ExtendedWalletIdentity,
    extendedWalletIdentitySchema,
    ExtendedWalletTransaction,
} from '@/app/ExtendedWallet/extendedWalletSchema';
import {
    CONFIRMED_COMMITMENT,
    TOKEN_PROGRAM_ID,
    WALLET_DERIVATION_PATH,
} from '@/app/ExtendedWallet/solana/config';
import { AccountLayout } from '@/app/ExtendedWallet/solana/layouts';
import { ZERO } from '@/constants/numbers';
import { hexToUint8Array, uint8ArrayToHex } from '@/resources/utils/encoding';
import { getTransactionExplorerUrl } from '@/resources/web3/core/explorerUrls';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction,
    getAssociatedTokenAddress,
} from '@solana/spl-token';
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
import bs58 from 'bs58';
import { derivePath } from 'ed25519-hd-key';
import { Buffer } from 'node:buffer';
import { formatUnits, parseUnits } from 'viem';

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

    public static getKeyPairFromPrivateKeyString(privateKey: string): Keypair {
        return Keypair.fromSecretKey(hexToUint8Array(privateKey));
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
        return await this.sendTransactionWithRetries(
            solanaNetworkClient,
            versionedTransaction,
            fromKeypair
        );
    }

    public static async transferToken(
        solanaNetworkClient: Connection,
        tokenMintPublicKey: PublicKey,
        amount: number,
        toPublicKey: PublicKey,
        fromKeypair: Keypair
    ): Promise<string> {
        const versionedTransaction = await this.createTokenTransferTransaction(
            solanaNetworkClient,
            tokenMintPublicKey,
            amount,
            toPublicKey,
            fromKeypair
        );

        versionedTransaction.sign([fromKeypair]);

        return await solanaNetworkClient.sendTransaction(versionedTransaction, {
            skipPreflight: false,
            preflightCommitment: CONFIRMED_COMMITMENT,
        });
    }

    public static async sendTransactionWithRetries(
        solanaNetworkClient: Connection,
        transaction: VersionedTransaction,
        fromKeypair: Keypair,
        maxRetries: number = 10,
        retryDelay: number = 1000 // 1 second
    ): Promise<string> {
        let retries = 0;
        let transactionHash: string | null = null;

        while (retries < maxRetries) {
            try {
                // Update blockhash before each retry
                const { blockhash, lastValidBlockHeight } =
                    await solanaNetworkClient.getLatestBlockhash();
                transaction.message.recentBlockhash = blockhash;

                // Resign the transaction with the updated blockhash
                transaction.sign([fromKeypair]);

                // Extract the transaction hash
                transactionHash = transaction.signatures[0]
                    ? bs58.encode(Buffer.from(transaction.signatures[0]))
                    : null;

                if (!transactionHash) {
                    throw new Error('Failed to generate transaction hash');
                }

                // Resubmit the same transaction with the updated blockhash
                await solanaNetworkClient.sendRawTransaction(transaction.serialize(), {
                    skipPreflight: false,
                    preflightCommitment: CONFIRMED_COMMITMENT,
                });

                // Wait for confirmation
                const confirmation = await solanaNetworkClient.confirmTransaction(
                    {
                        signature: transactionHash,
                        blockhash: blockhash,
                        lastValidBlockHeight: lastValidBlockHeight,
                    },
                    CONFIRMED_COMMITMENT
                );

                if (confirmation.value.err) {
                    console.warn(`Transaction ${transactionHash} failed. Retrying...`);
                } else {
                    console.log(`Transaction ${transactionHash} confirmed!`);
                    return transactionHash; // Exit if confirmed
                }
            } catch (error) {
                console.error(`Attempt ${retries + 1} failed: ${(error as Error).message}`);
            }

            retries += 1;
            console.log(`Retrying transaction... (${retries}/${maxRetries})`);
            await new Promise((resolve) => setTimeout(resolve, retryDelay)); // Wait before retrying
        }

        throw new Error(
            `Failed to confirm transaction after ${maxRetries} retries. Last transaction hash: ${transactionHash}`
        );
    }

    public static async transferTokenWithRetries(
        solanaNetworkClient: Connection,
        tokenMintPublicKey: PublicKey,
        amount: number,
        toPublicKey: PublicKey,
        fromKeypair: Keypair,
        maxRetries: number = 10,
        retryDelay: number = 1000 // 1 second
    ): Promise<string> {
        let retries = 0;
        let transactionHash: string | null = null;

        // Create transaction once, but refresh blockhash on retries
        let transaction = await this.createTokenTransferTransaction(
            solanaNetworkClient,
            tokenMintPublicKey,
            amount,
            toPublicKey,
            fromKeypair
        );

        while (retries < maxRetries) {
            try {
                // Update blockhash before each retry
                const { blockhash, lastValidBlockHeight } =
                    await solanaNetworkClient.getLatestBlockhash();
                transaction.message.recentBlockhash = blockhash;

                // Resign the transaction with the updated blockhash
                transaction.sign([fromKeypair]);

                // Extract the transaction hash
                transactionHash = transaction.signatures[0]
                    ? bs58.encode(Buffer.from(transaction.signatures[0]))
                    : null;

                if (!transactionHash) {
                    throw new Error('Failed to generate transaction hash');
                }

                // Resubmit the same transaction with the updated blockhash
                await solanaNetworkClient.sendRawTransaction(transaction.serialize(), {
                    skipPreflight: false,
                    preflightCommitment: CONFIRMED_COMMITMENT,
                });

                // Wait for confirmation
                const confirmation = await solanaNetworkClient.confirmTransaction(
                    {
                        signature: transactionHash,
                        blockhash: blockhash,
                        lastValidBlockHeight: lastValidBlockHeight,
                    },
                    CONFIRMED_COMMITMENT
                );

                if (confirmation.value.err) {
                    console.warn(`Transaction ${transactionHash} failed. Retrying...`);
                } else {
                    console.log(`Transaction ${transactionHash} confirmed!`);
                    return transactionHash; // Exit if confirmed
                }
            } catch (error) {
                console.error(`Attempt ${retries + 1} failed: ${(error as Error).message}`);
            }

            retries += 1;
            console.log(`Retrying transaction... (${retries}/${maxRetries})`);
            await new Promise((resolve) => setTimeout(resolve, retryDelay)); // Wait before retrying
        }

        throw new Error(
            `Failed to confirm transaction after ${maxRetries} retries. Last transaction hash: ${transactionHash}`
        );
    }

    private static async createTokenTransferTransaction(
        solanaNetworkClient: Connection,
        tokenMintPublicKey: PublicKey,
        amount: number,
        toPublicKey: PublicKey,
        fromKeypair: Keypair
    ): Promise<VersionedTransaction> {
        const [tokenAccount, tokenDecimals, receiverTokenAccount] = await Promise.all([
            this.getTokenAccount(solanaNetworkClient, tokenMintPublicKey, fromKeypair.publicKey),
            this.getTokenDecimals(solanaNetworkClient, tokenMintPublicKey),
            this.getTokenAccountPublicKey(solanaNetworkClient, tokenMintPublicKey, toPublicKey),
        ]);

        if (!tokenAccount) {
            throw new Error('Token account not found');
        }

        const instructions: TransactionInstruction[] = [];

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

        return versionedTransaction;
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
    public static async getTokenDecimals(
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
