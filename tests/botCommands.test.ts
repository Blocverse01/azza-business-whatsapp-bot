import { PHONE_NUMBER_IDS } from '../src/config/whatsAppPhoneNumbers';
import BotCommandHandler from '../src/app/WhatsAppBot/BotCommandHandler';
import { TEN_THOUSAND } from '../src/constants/numbers';

describe('Bot Commands', () => {
    describe('BOT_COMMANDS_REGEX', () => {
        it('should match /rates', () => {
            const text = '/rates';
            const isCommand = BotCommandHandler.isCommand(text);

            expect(isCommand).toBeTruthy();
        });
        it('should match /sell <asset> <network>', () => {
            const text = '/sell usdt polygon';
            const isCommand = BotCommandHandler.isCommand(text);

            expect(isCommand).toBeTruthy();
        });
        it('should match /balance', () => {
            const text = '/balance';
            const isCommand = BotCommandHandler.isCommand(text);

            expect(isCommand).toMatchObject({
                command: 'BALANCES',
                params: {},
            });
        });
        it('should match /balance <asset> <network>', () => {
            const text = '/balance usdt polygon';
            const isCommand = BotCommandHandler.isCommand(text);

            expect(isCommand).toMatchObject({
                command: 'ASSET_BALANCE',
                params: {
                    asset: 'usdt',
                    network: 'polygon',
                },
            });
        });
        it('should match /balance <network>', () => {
            const text = '/balance polygon';
            const isCommand = BotCommandHandler.isCommand(text);

            expect(isCommand).toMatchObject({
                command: 'ENTITY_BALANCE',
                params: {
                    network: 'polygon',
                },
            });
        });
        it('should match /balance <asset>', () => {
            const text = '/balance usdt';
            const isCommand = BotCommandHandler.isCommand(text);

            expect(isCommand).toMatchObject({
                command: 'ENTITY_BALANCE',
                params: {
                    asset: 'usdt',
                },
            });
        });
    });

    describe('Bot Commands Handling', () => {
        const phoneParams = {
            userPhoneNumber: '2348143100808',
            businessPhoneNumberId: PHONE_NUMBER_IDS.AMARA_FROM_AZZA_PHONE_NUMBER_ID,
        };

        it(
            'should handle /rates command',
            async () => {
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
            'should handle /sell [asset] [network] command',
            async () => {
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
            'should handle /buy [asset] [network] command',
            async () => {
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
                const response = await BotCommandHandler.handlePossibleCommand(
                    '/my_assets',
                    phoneParams,
                    'Test User'
                );

                expect(response.handled).toBe(true);
            },
            TEN_THOUSAND
        );
        it(
            'should handle /balance command',
            async () => {
                const response = await BotCommandHandler.handlePossibleCommand(
                    '/balance',
                    phoneParams,
                    'Test User'
                );

                expect(response.handled).toBe(true);
            },
            TEN_THOUSAND * 3
        );

        it(
            'should handle /balance [asset] [network] command',
            async () => {
                const response = await BotCommandHandler.handlePossibleCommand(
                    '/balance usdt polygon',
                    phoneParams,
                    'Test User'
                );

                expect(response.handled).toBe(true);
            },
            TEN_THOUSAND * 3
        );
        it(
            'should handle /balance [network] command',
            async () => {
                const response = await BotCommandHandler.handlePossibleCommand(
                    '/balance polygon',
                    phoneParams,
                    'Test User'
                );

                expect(response.handled).toBe(true);
            },
            TEN_THOUSAND * 3
        );
        it(
            'should handle /balance [asset] command',
            async () => {
                const response = await BotCommandHandler.handlePossibleCommand(
                    '/balance usdt',
                    phoneParams,
                    'Test User'
                );

                expect(response.handled).toBe(true);
            },
            TEN_THOUSAND * 3
        );
    });
});
