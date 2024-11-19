import { generateOnrampTransactionInitiatedMessage } from '../src/resources/utils/bot-message-utils';
import WhatsAppBotService from '../src/app/WhatsAppBot/WhatsAppBotService';
import { TEN_THOUSAND } from '../src/constants/numbers';

describe('Bot Messaging Utils', () => {
    it(
        'generates and sends onramp initiated message',
        async () => {
            const params = {
                tokenAmount: '0.5',
                assetName: 'BTC',
                assetNetwork: 'Bitcoin',
                fiatToPay: '5000',
                bankInfo: {
                    bankName: 'Bank of America',
                    accountName: 'John Doe',
                    accountNumber: '1234567890',
                },
                localCurrency: 'USD',
            };

            const message = generateOnrampTransactionInitiatedMessage(params);

            await WhatsAppBotService.sendArbitraryTextMessage('2348143100808', message);
        },
        TEN_THOUSAND
    );
});
