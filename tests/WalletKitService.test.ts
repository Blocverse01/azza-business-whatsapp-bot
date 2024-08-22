import WalletKitService from '@/app/WalletKit/WalletKitService';
import {
    CreateWalletKitWalletResponse,
    SignAndSendTransactionParams,
    SUPPORTED_CHAINS,
} from '@/app/WalletKit/walletKitSchema';
import { parseEther, toHex } from 'viem';
import { TEN_THOUSAND } from '../src/constants/numbers';
import env from '../src/constants/env';
import { isAxiosError } from 'axios';

describe('WalletKitService', () => {
    it('should create wallet successfully', async () => {
        const response = await WalletKitService.createUserWallet({
            network: 'Polygon',
            owner_id: '2348143100808',
            control_mode: 'developer',
            developer_secret: WalletKitService.DEVELOPER_SECRET,
            name: 'Polygon Wallet',
            type: 'contract',
        });

        // Assert
        expect(response).toBeDefined();
    });

    it('should get user wallet by network successfully', async () => {
        const response = await WalletKitService.getUserWalletByNetwork('2348143100808', 'Polygon');

        // Assert
        expect(response).toBeDefined();
    });

    it('should get user wallets successfully', async () => {
        const response = await WalletKitService.getUserWallets('2348143100808');

        // Assert
        expect(response.length).toBeGreaterThan(0);
    });

    it('should sign and send transaction successfully', async () => {
        const transactionParams: SignAndSendTransactionParams = {
            network: 'Polygon',
            signer_wallet_address: '0x2C0a6a30fAe9872513609819f667efA7e539021E',
            unsigned_transaction: {
                to: '0xd73594Ddc43B368719a0003BcC1a520c17a16DeB',
                value: toHex(parseEther('0.0006')),
            },
            developer_secret: WalletKitService.DEVELOPER_SECRET,
        };

        const response = await WalletKitService.signAndSendTransaction(transactionParams);

        // Assert
        expect(response).toBeDefined();
    });

    it('should get transaction status by id successfully', async () => {
        const response = await WalletKitService.getTransactionById(
            'a15ffcf6-0f01-42c8-a601-d2b351272df1'
        );

        // Assert
        expect(response).toBeDefined();
    });

    it('should transfer token successfully', async () => {
        // TODO: replace params.token with an actual token address
        const response = await WalletKitService.transferToken({
            network: 'Polygon',
            from: '0xc29c9D44b64dBA49a61FF76BB9EcBd7c0E542796',
            token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
            recipient: '0xc29c9D44b64dBA49a61FF76BB9EcBd7c0E542796',
            amount: '0.01',
            developer_secret: WalletKitService.DEVELOPER_SECRET,
        });

        // Assert
        expect(response).toBeDefined();
    });

    it(
        'should create wallet for supported networks if it does not exist',
        async () => {
            const user_id = '2348143100808';

            const userWallets = await WalletKitService.getUserWallets(user_id);

            const promises: Array<Promise<CreateWalletKitWalletResponse>> = [];

            SUPPORTED_CHAINS.forEach((network) => {
                const wallet = userWallets.find((wallet) => wallet.network === network);

                if (!wallet) {
                    promises.push(
                        WalletKitService.createUserWallet({
                            network,
                            owner_id: user_id,
                            control_mode: 'developer',
                            developer_secret: WalletKitService.DEVELOPER_SECRET,
                            name: `${network} Wallet`,
                            type: 'contract',
                        })
                    );
                }
            });

            const responses = await Promise.all(promises);

            // Assert
            expect(responses.length).toBeGreaterThan(0);
        },
        TEN_THOUSAND * 100
    );

    it('Should export wallet successfully', async () => {
        const response = await WalletKitService.exportWallet({
            network: 'Optimism',
            address: '0x4d81Cb192C26F50C31870053Fae9A7C84c8fC0c6',
            developer_secret: WalletKitService.DEVELOPER_SECRET,
        });

        console.log({ response });

        // Assert
        expect(response).toBeDefined();
    });
});
