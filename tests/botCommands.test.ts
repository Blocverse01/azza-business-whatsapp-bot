import { BOT_COMMANDS_REGEX } from '../src/constants/regex';
import { PHONE_NUMBER_IDS } from '../src/config/whatsAppPhoneNumbers';
import BotCommandHandler from '../src/app/WhatsAppBot/BotCommandHandler';
import { TEN_THOUSAND } from '../src/constants/numbers';

describe('Bot Commands', () => {
    describe('BOT_COMMANDS_REGEX', () => {
        it('should match /rates', () => {
            const text = '/rates';
            const match = text.match(BOT_COMMANDS_REGEX.RATES);

            expect(match).toBeTruthy();
        });
        it('should match /sell <asset> <network>', () => {
            const text = '/sell usdt polygon';
            const match = text.match(BOT_COMMANDS_REGEX.SELL_ASSET);

            expect(match).toBeTruthy();
        });
    });
    describe('Bot Commands Handling', () => {
        it(
            'should handle /rates command',
            async () => {
                const phoneParams = {
                    userPhoneNumber: '2348143100808',
                    businessPhoneNumberId: PHONE_NUMBER_IDS.AMARA_FROM_AZZA_PHONE_NUMBER_ID,
                };

                const response = await BotCommandHandler.handlePossibleCommand(
                    '/rates',
                    phoneParams,
                    'Test User'
                );

                expect(response.handled).toBe(true);
            },
            TEN_THOUSAND
        );
        it(
            'should handle /sell <asset> <network> command',
            async () => {
                const phoneParams = {
                    userPhoneNumber: '2348143100808',
                    businessPhoneNumberId: PHONE_NUMBER_IDS.AMARA_FROM_AZZA_PHONE_NUMBER_ID,
                };

                const response = await BotCommandHandler.handlePossibleCommand(
                    '/sell usdt polygon',
                    phoneParams,
                    'Test User'
                );

                expect(response.handled).toBe(true);
            },
            TEN_THOUSAND
        );
        it(
            'should handle /buy <asset> <network> command',
            async () => {
                const phoneParams = {
                    userPhoneNumber: '2348143100808',
                    businessPhoneNumberId: PHONE_NUMBER_IDS.AMARA_FROM_AZZA_PHONE_NUMBER_ID,
                };

                const response = await BotCommandHandler.handlePossibleCommand(
                    '/buy usdt polygon',
                    phoneParams,
                    'Test User'
                );

                expect(response.handled).toBe(true);
            },
            TEN_THOUSAND
        );
        it(
            'should handle /my_assets command',
            async () => {
                const phoneParams = {
                    userPhoneNumber: '2348143100808',
                    businessPhoneNumberId: PHONE_NUMBER_IDS.AMARA_FROM_AZZA_PHONE_NUMBER_ID,
                };

                const response = await BotCommandHandler.handlePossibleCommand(
                    '/my_assets',
                    phoneParams,
                    'Test User'
                );

                expect(response.handled).toBe(true);
            },
            TEN_THOUSAND
        );
    });
});
