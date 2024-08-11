import CryptoPayoutService from '../src/app/CryptoPayout/CryptoPayoutService';
import { TokenNames } from '../src/Resources/web3/tokens';
import { TEN_THOUSAND } from '../src/constants/numbers';

describe('CryptoPayoutService', () => {
    it(
        'Should create onramp crypto payout order',
        async () => {
            await CryptoPayoutService.createOnrampCryptoPayoutOrder({
                triggerTransactionId: 'globachain-68819330-48e9-4f05-98e6-408d66a90d57',
                network: 'Polygon',
                tokenSymbol: TokenNames.USDC,
                amount: 2,
                destinationWalletAddress: '0xC506613F64F79aF5527A5c46188b4169B4132D00',
            });
        },
        TEN_THOUSAND
    );
});
