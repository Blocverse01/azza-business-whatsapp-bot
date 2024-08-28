import {
    createSolanaNetworkClient,
    getSolanaNodeConfigOrThrow,
    SolanaNode,
} from '../src/app/ExtendedWallet/solana/config';
import { devWalletSchema } from '../src/app/ExtendedWallet/extendedWalletSchema';
import fs from 'node:fs';
import ExtendedSolanaWallet from '../src/app/ExtendedWallet/solana/ExtendedSolanaWallet';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// Node Config
const nodeKey: SolanaNode = 'solana-devnet';
const nodeConfig = getSolanaNodeConfigOrThrow(nodeKey);
const solanaNetworkClient = createSolanaNetworkClient(nodeConfig);

// Dev Wallet
const mnemonicFilePath = '.devfiles/solana-account.json';
const SOLANA_ACCOUNT = devWalletSchema.parse(
    JSON.parse(fs.readFileSync(mnemonicFilePath, 'utf-8'))
);
const extendedSolanaWallet = new ExtendedSolanaWallet(SOLANA_ACCOUNT.mnemonic, nodeKey);
const SOLANA_TESTNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('ExtendedSolanaWallet', () => {
    it('should return the correct wallet identity', () => {
        // Arrange
        const mnemonic = SOLANA_ACCOUNT.mnemonic;
        const expectedAddress = SOLANA_ACCOUNT.address;

        // Act
        const solanaWallet = new ExtendedSolanaWallet(mnemonic, nodeKey);

        // Assert
        expect(solanaWallet.address).toBe(expectedAddress);
    });

    it('should return the correct network', () => {
        // Arrange
        const mnemonic = SOLANA_ACCOUNT.mnemonic;

        // Act
        const solanaWallet = new ExtendedSolanaWallet(mnemonic, nodeKey);

        // Assert
        expect(solanaWallet.network).toBe('Solana');
    });
    it('should return the correct wallet native balance', async () => {
        // Arrange
        const expectedBalance =
            (await solanaNetworkClient.getBalance(extendedSolanaWallet.publicKey)) /
            LAMPORTS_PER_SOL;

        // Act
        const balance = await extendedSolanaWallet.getWalletNativeBalance();

        // Assert
        expect(balance).toBe(expectedBalance);
    });
    it('should return the correct wallet token balance', async () => {
        // Arrange
        const expectedBalance = 10; // Replace with the expected balance

        // Act
        const balance = await extendedSolanaWallet.getWalletTokenBalance(SOLANA_TESTNET_USDC);

        // Assert
        expect(balance).toBe(expectedBalance);
    });

    it('should transfer native token to address', async () => {
        // Arrange
        const amount = 0.05;
        const toAddress = 'Bj454a2ByAFp83izF8uqH6FJhwpujGrfLeSiUKZtC5zv'; // Replace with any other address

        // Act
        const response = await extendedSolanaWallet.transferNativeToken(amount, toAddress);

        console.log(`Transaction Hash: ${response.transactionHash}`);

        // Assert
        expect(response).toBeDefined();
        expect(response.transactionHash).toBeDefined();
        expect(response.status).toBe('submitted');
    });
    it('should transfer token to address', async () => {
        // Arrange
        const amount = 0.01;
        const toAddress = 'Bj454a2ByAFp83izF8uqH6FJhwpujGrfLeSiUKZtC5zv'; // Replace with any other address

        // Act
        const response = await extendedSolanaWallet.transferToken(
            SOLANA_TESTNET_USDC,
            amount,
            toAddress
        );

        console.log(`Transaction Hash: ${response.transactionHash}`);

        // Assert
        expect(response).toBeDefined();
        expect(response.transactionHash).toBeDefined();
        expect(response.status).toBe('submitted');
    });

    it('should get transaction correctly', async () => {
        // Arrange
        const successfulTransactionId =
            '4omFB1WKSjH3CDcHEZp2AuVvfwDHmceedaTu21aDzYr3not1Y1pbrPs1RRr4X4Sp9KXWm1itopURhS9EhaBvkYPp'; // Ensure transaction exists on the network before running this test

        // Act
        const [successfulTransactionResponse] = await Promise.all([
            extendedSolanaWallet.getTransaction(successfulTransactionId),
        ]);

        // Assert
        expect(successfulTransactionResponse.status).toBe('success');
        expect(successfulTransactionResponse.transactionHash).toBe(successfulTransactionId);
        expect(successfulTransactionResponse.explorerUrl).toBeDefined();
    });
});
