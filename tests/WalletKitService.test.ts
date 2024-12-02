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
            network: 'Base',
            from: '0x60f50c703CAb09e9525c97AB921a6b5E1Aa87747',
            token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
            recipient: '0x4d81Cb192C26F50C31870053Fae9A7C84c8fC0c6',
            amount: '5',
            developer_secret: 'uPdEemxVaGWJ4MhHHXYqCOSUoC9YLm4C2BL2Bk0M+Z7vAZm4SYm71Tm0mxhQt2lL',
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
