import CryptoPayoutService from '../src/app/CryptoPayout/CryptoPayoutService';
import { TokenNames } from '../src/resources/web3/tokens';
import { TEN_THOUSAND } from '../src/constants/numbers';
import CryptoPayoutCronJobService, {
    CryptoPendingOrderGroup,
} from '../src/app/CryptoPayout/CryptoPayoutCronJobService';
import { CryptoPayoutOrderStatus } from '../src/app/CryptoPayout/cryptoPayoutSchema';

describe('CryptoPayoutService', () => {
    it(
        'Should create onramp crypto payout order',
        async () => {
            await CryptoPayoutService.createOnrampCryptoPayoutOrder({
                triggerTransactionId: 'globachain-388934f1-b08a-4573-9c23-e1fc6bc6e313',
                network: 'Optimism',
                tokenSymbol: TokenNames.USDT,
                amount: 0.5,
                destinationWalletAddress: '0x4d81Cb192C26F50C31870053Fae9A7C84c8fC0c6',
            });
        },
        TEN_THOUSAND
    );

    it('should update crypto payout orders status', async () => {
        const response = await CryptoPayoutService.updateCryptoPayoutOrdersStatus(
            ['NwLZfT1ZnZSkuSumu6HXJ31Q', 'BykcB9OXh20STBVw3PzFo3pn'],
            CryptoPayoutOrderStatus.PENDING
        );

        expect(response.records).toBeDefined();
    });

    describe('CryptoPayoutCronJobService', () => {
        it('should get and orders', async () => {
            const orders = await CryptoPayoutService.getValidPendingCryptoPayoutOrders();
            expect(orders).toBeDefined();

            const groupedOrders =
                CryptoPayoutCronJobService.groupCryptoOrdersByTokenAndNetwork(orders);

            expect(groupedOrders).toBeInstanceOf(Array<CryptoPendingOrderGroup>);
        });
    });
});
