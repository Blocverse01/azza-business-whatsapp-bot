import FiatRampService from '@/app/FiatRamp/FiatRampService';
import {
    getCurrenciesResponseSchema,
    GetMobileProvidersResponse,
    getMobileProvidersResponseSchema,
    GetPaymentMethodsResponse,
    getPaymentMethodsResponseSchema,
    OnrampTransactionPayload,
    SendOfframpRequestPayload,
} from '@/app/FiatRamp/fiatRampSchema';
import { TEN_THOUSAND } from '@/constants/numbers';
import UserService from '../src/app/User/UserService';

describe('FiatRampService', () => {
    describe('Core', () => {
        it('Should Get Supported Fiat Currencies', async () => {
            const supportedCurrencies = await FiatRampService.getSupportedCurrencies();

            const responseValidation = getCurrenciesResponseSchema
                .pick({
                    data: true,
                })
                .safeParse({
                    data: supportedCurrencies,
                });

            // Assert
            expect(supportedCurrencies.length).toBeGreaterThan(0);
            expect(responseValidation.success).toBeTruthy();
        });

        it('Should Get Transaction Fees', async () => {
            const transactionFee = await FiatRampService.getTransactionFee('NG', 'onramp');
            expect(transactionFee).toBeDefined();
        });

        it(
            'Should Get All Rates',
            async () => {
                const allRates = await FiatRampService.getMultipleRates([
                    'NGN',
                    'KES',
                    'GHS',
                    'BWP',
                ]);

                expect(allRates).toBeDefined();
            },
            TEN_THOUSAND * 10
        );

        it(
            'Should Get Quotes',
            async () => {
                const quotes = await FiatRampService.getQuotes('NGN', 'NG', 'onramp');

                // Assert
                expect(quotes).toBeDefined();
            },
            TEN_THOUSAND * 2
        );

        it(
            'Should Get Payment Methods',
            async () => {
                const response = await FiatRampService.getPaymentMethods('NG', 'onramp');

                console.log(response);

                const responseValidation = getPaymentMethodsResponseSchema
                    .pick({
                        data: true,
                    })
                    .safeParse({
                        data: {
                            channels: response.paymentChannels,
                            limits: response.countryFiatLimits,
                        },
                    } satisfies GetPaymentMethodsResponse);

                // Assert
                expect(responseValidation.success).toBeTruthy();
            },
            TEN_THOUSAND
        );

        it(
            'Should Get Supported Mobile Providers',
            async () => {
                const channels = await FiatRampService.getPaymentMethods('MW', 'offramp');

                const phoneChannel = channels.paymentChannels.find(
                    (channel) => channel.channelName === 'phone'
                );

                if (!phoneChannel) {
                    throw new Error('Phone channel not found');
                }

                const mobileProviders = await FiatRampService.getSupportedMobileProviders(
                    phoneChannel.channelId
                );

                const responseValidation = getMobileProvidersResponseSchema
                    .pick({
                        data: true,
                    })
                    .safeParse({
                        data: mobileProviders,
                    } satisfies GetMobileProvidersResponse);

                // Assert
                expect(responseValidation.success).toBeTruthy();
                expect(mobileProviders).toBeDefined();
            },
            TEN_THOUSAND * 2
        );
    });
    describe('Onramp', () => {
        it(
            'Should send onramp transaction',
            async () => {
                const channels = await FiatRampService.getPaymentMethods('NG', 'onramp');

                const bankChannel = channels.paymentChannels.find(
                    (channel) => channel.channelName === 'bank'
                );

                if (!bankChannel) {
                    throw new Error('Bank channel not found');
                }

                const userDetails = await UserService.getUserIdentityInfo('2348143100808');

                if (!userDetails) {
                    throw new Error('User identity info not found');
                }

                const transactionPayload: OnrampTransactionPayload = {
                    channelId: bankChannel.channelId,
                    country: 'NG',
                    accountType: 'bank',
                    localAmount: 2000,
                    chainName: 'ETHEREUM',
                    tokenName: 'USDT',
                    userWalletAddress: '0x2C0a6a30fAe9872513609819f667efA7e539021E',
                    userDetails: userDetails,
                    customerId: '2348143100808',
                };

                const response = await FiatRampService.postOnRampTransaction(transactionPayload);

                console.log(response);

                expect(response).toBeDefined();
            },
            TEN_THOUSAND * 3
        );

        it('Should get onramp transaction status', async () => {
            const sequenceId = '';

            const response = await FiatRampService.getTransactionStatus(sequenceId, 'onramp');

            // Assert
            expect(response).toBeDefined();
        });
    });

    describe('Offramp', () => {
        it(
            'Should get supported banks',
            async () => {
                const channels = await FiatRampService.getPaymentMethods('NG', 'offramp');
                const bankChannel = channels.paymentChannels.find(
                    (channel) => channel.channelName === 'bank'
                );

                if (!bankChannel) {
                    throw new Error('Bank channel not found');
                }

                const supportedBanks = await FiatRampService.getSupportedBanks(
                    bankChannel.channelId
                );

                console.log(supportedBanks);
            },
            TEN_THOUSAND * 2
        );
        it(
            'Should create owner beneficiary',
            async () => {
                const channels = await FiatRampService.getPaymentMethods('NG', 'offramp');
                const bankChannel = channels.paymentChannels.find(
                    (channel) => channel.channelName === 'bank'
                );

                if (!bankChannel) {
                    throw new Error('Bank channel not found');
                }

                const supportedBanks = await FiatRampService.getSupportedBanks(
                    bankChannel.channelId
                );

                const choiceBank = supportedBanks.find(
                    (bank) => bank.slug.toLowerCase() === 'access-bank'
                );

                if (!choiceBank) {
                    throw new Error('Bank not found');
                }

                const ownerId = '2349057774260';

                const beneficiaryId = await FiatRampService.createBeneficiary(
                    ownerId,
                    'NG',
                    'bank',
                    {
                        beneficiary: {
                            countryId: 'rec_ckhg3eg7afgqhtu4ijj0',
                            accountName: 'Onyewuchi Esther',
                            accountNumber: '1704545925',
                            bankName: choiceBank.name,
                            channelId: choiceBank.channelId,
                            networkId: choiceBank.networkId,
                        },
                    }
                );

                console.log({ beneficiaryId });
            },
            TEN_THOUSAND * 2
        );
        it(
            'Should get users beneficiaries',
            async () => {
                const ownerId = '2348143100808';
                const beneficiaries = await FiatRampService.getBeneficiaries(ownerId, 'NG', 'bank');

                console.log(beneficiaries);

                expect(beneficiaries).toBeDefined();
            },
            TEN_THOUSAND * 3
        );
        it('Should get hot wallet address', async () => {
            const hotWalletAddress = await FiatRampService.getHotWalletForNetwork('evm');

            console.log({ hotWalletAddress });

            expect(hotWalletAddress).toBeDefined();
        });
        it(
            'Should send offramp transaction',
            async () => {
                const transactionPayload: SendOfframpRequestPayload = {
                    beneficiaryId: 'rec_cppfpjc5j7ivr69md950',
                    localAmount: 14900,
                    chainName: 'BEP20',
                    tokenName: 'USDT',
                    userWalletAddress: '0x4d81Cb192C26F50C31870053Fae9A7C84c8fC0c6',
                    hotWalletAddress: '0xd73594Ddc43B368719a0003BcC1a520c17a16DeB',
                    usdAmount: 10.1,
                    tokenAddress: '0x55d398326f99059ff775485246999027b3197955',
                    txHash: '0xab190f51ef8f330bc38b3ad938e2c5e23ffdb46b218310b5dcf11976973265ed_test',
                };

                const response = await FiatRampService.postOfframpTransaction(transactionPayload);

                console.log(response);

                expect(response).toBeDefined();
            },
            TEN_THOUSAND * 2
        );
    });
});
