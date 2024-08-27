import ExtendedTronWallet from '../src/app/ExtendedWallet/tron/ExtendedTronWallet';
import ExtendedTronWalletLibrary from '../src/app/ExtendedWallet/tron/ExtendedTronWalletLibrary';
import {
    createPrivateNodeConfig,
    getTronNodeConfig,
    TronNode,
} from '../src/app/ExtendedWallet/tron/config';
import {
    createPrivateTronWebClient,
    createTronWebClient,
} from '../src/app/ExtendedWallet/tron/tronNetworkClient';
import { TEN_THOUSAND } from '../src/constants/numbers';
import * as fs from 'node:fs';
import { devWalletSchema } from '../src/app/ExtendedWallet/extendedWalletSchema';
import { formatUnits } from 'viem';

const nodeKey: TronNode = 'tron-grid-shasta';

const nodeConfig = getTronNodeConfig(nodeKey);
const tronNetworkClient = createTronWebClient(nodeConfig);

const TESTNET_TRC20_TOKEN = 'TWy8FMyiDX3UAmU2RMpLTUEUWpjc84M3RF';
const MAINNET_USDT_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const mnemonicFilePath = '.devfiles/tron-account.json';
const TRON_ACCOUNT = devWalletSchema.parse(JSON.parse(fs.readFileSync(mnemonicFilePath, 'utf-8')));
const DEV_EXTENDED_TRON_WALLET = new ExtendedTronWallet(TRON_ACCOUNT.mnemonic, nodeKey);

describe('ExtendedWallet', () => {
    describe('ExtendedTronWallet', () => {
        it('should return the correct wallet identity', () => {
            // Arrange
            const randomWallet = tronNetworkClient.createRandom();
            const mnemonic = randomWallet.mnemonic?.phrase ?? '';
            const expectedAddress = randomWallet.address;
            const expectedPrivateKey = randomWallet.privateKey;

            // Act
            const tronWallet = new ExtendedTronWallet(mnemonic, nodeKey);

            // Assert
            expect(tronWallet.address).toBe(expectedAddress);
            expect(tronWallet.privateKey).toBe(expectedPrivateKey);
        });

        it('should return the correct network', () => {
            // Arrange
            const randomWallet = tronNetworkClient.createRandom();
            const mnemonic = randomWallet.mnemonic?.phrase ?? '';

            // Act
            const tronWallet = new ExtendedTronWallet(mnemonic, nodeKey);

            // Assert
            expect(tronWallet.network).toBe('Tron');
        });

        it('should return the correct wallet native balance', async () => {
            // Arrange
            const expectedBalance = Number(
                tronNetworkClient.fromSun(
                    await tronNetworkClient.trx.getBalance(DEV_EXTENDED_TRON_WALLET.address)
                )
            );

            // Act
            const balance = await DEV_EXTENDED_TRON_WALLET.getWalletNativeBalance();

            // Assert
            expect(balance).toBe(expectedBalance);
        });

        it(
            'should return the correct wallet token balance',
            async () => {
                // Arrange
                const targetWalletAddress = DEV_EXTENDED_TRON_WALLET.address;
                const tokenAddress = TESTNET_TRC20_TOKEN;

                // Initialize the contract
                const contract = await tronNetworkClient.contract().at(tokenAddress);
                tronNetworkClient.setAddress(targetWalletAddress); // This is a workaround for this issue: https://github.com/tronprotocol/tronweb/issues/90

                // Call balanceOf method
                const [decimals, tokenBalance] = await Promise.all([
                    ExtendedTronWalletLibrary.getTokenDecimals(tronNetworkClient, tokenAddress),
                    contract.methods.balanceOf(targetWalletAddress).call(),
                ]);

                // Convert token balance to decimal
                const expectedBalance = Number(
                    formatUnits(tokenBalance as unknown as bigint, decimals)
                );

                // Act
                const balance = await DEV_EXTENDED_TRON_WALLET.getWalletTokenBalance(tokenAddress);

                // Assert
                expect(balance).toBe(expectedBalance);
            },
            TEN_THOUSAND
        );

        it('should transfer native token to address', async () => {
            // Arrange
            const amount = 0.0005;
            const toAddress = TESTNET_TRC20_TOKEN; // Replace with any other address

            // Act
            const transactionHash = await DEV_EXTENDED_TRON_WALLET.transferNativeToken(
                amount,
                toAddress
            );

            console.log(`Transaction Hash: ${transactionHash}`);

            // Assert
            expect(transactionHash).toBeDefined();
        });

        it(
            'should transfer token to address',
            async () => {
                const privateTronClient = createPrivateTronWebClient(
                    createPrivateNodeConfig(nodeKey, DEV_EXTENDED_TRON_WALLET.privateKey)
                );

                const amount = 2000;
                const tokenAddress = TESTNET_TRC20_TOKEN;
                const toAddress = 'TRSUjm3VvfMGu5BjW3B1ACoeXsGBGYr5Js'; // Replace with any other address

                const transactionHash = await ExtendedTronWalletLibrary.transferToken(
                    privateTronClient,
                    tokenAddress,
                    amount,
                    toAddress
                );

                console.log(`Transaction Hash: ${transactionHash}`);

                expect(transactionHash).toBeDefined();
            },
            TEN_THOUSAND
        );

        it('should get transaction info correctly', async () => {
            // Arrange
            const successfulTransactionId =
                'd49d322327dc53875d5e3061831852985aca1aafc794496b508d86398c0de9c0'; // Ensure transaction exists on the network before running this test
            const failedTransactionId =
                'bc630b51a88376ec1ae53b763930746cca76e328a4730a7ba21923331ee553e5';
            const unSubmittedTransactionId =
                '5c0a2ff276320c4fbef256295eb88cfd0311cb8f543a3afcaf87921a2152d686';

            // Act
            const [
                successfulTransactionResponse,
                failedTransactionResponse,
                unSubmittedTransactionResponse,
            ] = await Promise.all([
                DEV_EXTENDED_TRON_WALLET.getTransaction(successfulTransactionId),
                DEV_EXTENDED_TRON_WALLET.getTransaction(failedTransactionId),
                DEV_EXTENDED_TRON_WALLET.getTransaction(unSubmittedTransactionId),
            ]);

            // Assert
            expect(successfulTransactionResponse).toBeDefined();
            expect(failedTransactionResponse).toBeDefined();
            expect(successfulTransactionResponse.status).toBe('success');
            expect(failedTransactionResponse.status).toBe('failed');
            expect(successfulTransactionResponse.transactionHash).toBe(successfulTransactionId);
            expect(failedTransactionResponse.transactionHash).toBe(failedTransactionId);
            expect(successfulTransactionResponse.explorerUrl).toBeDefined();
            expect(unSubmittedTransactionResponse.status).toBe('pending');
            expect(unSubmittedTransactionResponse.transactionHash).toBe(unSubmittedTransactionId);
        });
    });
});
