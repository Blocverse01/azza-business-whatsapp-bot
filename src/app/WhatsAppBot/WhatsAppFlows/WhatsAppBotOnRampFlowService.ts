import { getMinimumOnrampUsdAmount, ONRAMP_MINIMUM_BY_CHAIN } from '@/app/FiatRamp/config';
import { OnrampTransactionPayload, TransactionStatus } from '@/app/FiatRamp/fiatRampSchema';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { getFallBackRegionalPhoneNumber } from '@/app/FiatRamp/utils';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { getFlowConfig } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import { DropdownOption, type FlowMode } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import env from '@/constants/env';
import { ERROR_FEEDBACK_ICON, SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { SIXTEEN, TWO } from '@/constants/numbers';
import { UserV2Record } from '@/db/xata';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import {
    generateOnrampTransactionInitiatedMessage,
    generateOnrampTransactionInitiatedWithMomoPaymentMessage,
} from '@/resources/utils/bot-message-utils';
import {
    fixNumber,
    formatNumberAsCurrency,
    getCountryFlagEmoji,
    prettifyNumber,
} from '@/resources/utils/currency';
import { generateRandomHexString } from '@/resources/utils/encryption';
import { standardizePhoneNumberOrReturnError } from '@/resources/utils/phone-numbers';
import { validateWalletAddress } from '@/resources/utils/validators';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import { AssetConfig, TokenNames } from '@/resources/web3/core/tokens';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { CountryCode, PhoneNumber } from 'libphonenumber-js';
import * as math from 'mathjs';

enum OnRampFlowScreens {
    TRANSACTION_DETAILS = 'TRANSACTION_DETAILS',
    TRANSACTION_SUMMARY = 'TRANSACTION_SUMMARY',
    BANK_PAYMENT = 'BANK_PAYMENT',
    MOMO_PAYMENT = 'MOMO_PAYMENT',
    PROCESSING_FEEDBACK = 'PROCESSING_FEEDBACK',
    ERROR_FEEDBACK = 'ERROR_FEEDBACK',
}

type ScreenPayload = {
    TRANSACTION_DETAILS: {
        dynamic_page_title: string;
        payment_methods: Array<DropdownOption>;
        amount_denominations: Array<DropdownOption>;
        asset_label: string;
        asset_id: string;
        user_id: string;
        local_currency: string;
        country_code: string;
        amount_input_label: string;
        amount_denomination_label: string;
        init_values: {
            payment_method: string;
            wallet_address?: string;
            amount?: string;
            amount_denomination: string;
        };
        error_messages?: {
            wallet_address?: string;
            amount?: string;
        };
    };
    TRANSACTION_SUMMARY: {
        display_data: {
            token_amount: string;
            fiat_to_pay: string;
            payment_method: string;
        };
        transaction_details: {
            channel_id: string;
            token_amount: string;
            transaction_fee: string;
            fiat_to_pay: string;
            external_wallet_address: string;
            platform_fee_percentage: string;
            conversion_rate: string;
        };
        buying_to_external_wallet: boolean;
        asset_id: string;
        user_id: string;
        local_currency: string;
        country_code: string;
        account_type: OnrampTransactionPayload['accountType'];
    };
    BANK_PAYMENT: {
        asset_id: string;
        amount: string;
        local_currency: string;
        bank_name: string;
        account_number: string;
        sequence_id: string;
        account_name: string;
        user_id: string;
    };
    MOMO_PAYMENT: {
        asset_id: string;
        amount: string;
        transaction_details: ScreenPayload['TRANSACTION_SUMMARY']['transaction_details'];
        local_currency: string;
        mobile_money_providers: Array<DropdownOption>;
        channel_id: string;
        user_id: string;
        buying_to_external_wallet: boolean;
        country_code: string;
        error_messages?: {
            mobile_number?: string;
        };
        init_values?: {
            mobile_provider?: string;
            first_name?: string;
            last_name?: string;
            mobile_number?: string;
        };
    };
    FEEDBACK_SCREEN: {
        message: string;
        status: TransactionStatus;
        asset_id: string;
        is_on_ramp_transaction: boolean;
        icon_src: string;
    };
};

type DataExchangePayload = {
    TRANSACTION_DETAILS: {
        payment_method: string;
        payment_methods: Array<DropdownOption>;
        asset_id: string;
        wallet_address?: string;
        amount: string;
        user_id: string;
        local_currency: string;
        country_code: string;
        amount_denomination: string
    };
    TRANSACTION_SUMMARY: {
        asset_id: string;
        user_id: string;
        buying_to_external_wallet: boolean;
        transaction_details: ScreenPayload['TRANSACTION_SUMMARY']['transaction_details'];
        local_currency: string;
        country_code: string;
        account_type: OnrampTransactionPayload['accountType'];
    };
    BANK_PAYMENT: {
        asset_id: string;
        account_number: string;
        amount: string;
        bank_name: string;
        sequence_id: string;
        account_name: string;
        user_id: string;
    };
    MOMO_PAYMENT: {
        asset_id: string;
        mobile_number: string;
        mobile_provider: string;
        first_name: string;
        last_name: string;
        channel_id: string;
        mobile_providers: Array<DropdownOption>;
        user_id: string;
        country_code: string;
        buying_to_external_wallet: boolean;
        local_currency: string;
        transaction_details: ScreenPayload['TRANSACTION_SUMMARY']['transaction_details'];
    };
};

type TokenAmountPattern =
    `${number} ${TokenNames} (${AllSupportedBlockchains})\n---------------------------------\nFee = ${number} ${TokenNames}`;

type FiatToPayPattern = `${string}\n---------------------------------\n1 ${TokenNames} = ${string}`;

const SECTION_SEPARATOR = '\n---------------------------------\n' as const;

const flowConfig = getFlowConfig('ONRAMP', env.WA_PHONE_NUMBER_ID);

class WhatsAppBotOnRampFlowService {
    private static readonly FLOW_MODE: FlowMode = flowConfig.flowMode;
    private static readonly FLOW_ID = flowConfig.flowId;
    private static readonly INITIAL_SCREEN = OnRampFlowScreens.TRANSACTION_DETAILS;

    public static async receiveDataExchange(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ): Promise<DataExchangeResponse> {
        const { action, screen, data } = requestBody;

        if (action === 'INIT') {
            // Using Preview data because initialization should typically be done from `WhatsAppBotService.beginOnRampFlowMessage`
            return this.previewInitializationFlow(requestBody);
        }

        if (action === 'data_exchange') {
            let nextScreenData: Omit<DataExchangeResponse, 'version'> | undefined;

            switch (screen) {
                case OnRampFlowScreens.TRANSACTION_DETAILS:
                    nextScreenData = await this.getTransactionSummaryScreenData(
                        data as DataExchangePayload['TRANSACTION_DETAILS']
                    );
                    break;
                case OnRampFlowScreens.TRANSACTION_SUMMARY:
                    nextScreenData = await this.getPaymentScreenData(
                        data as DataExchangePayload['TRANSACTION_SUMMARY']
                    );
                    break;
                case OnRampFlowScreens.BANK_PAYMENT:
                    nextScreenData = await this.getBankPaymentFeedbackScreenData(
                        data as DataExchangePayload['BANK_PAYMENT']
                    );
                    break;
                case OnRampFlowScreens.MOMO_PAYMENT:
                    nextScreenData = await this.getMomoPaymentFeedbackScreenData(
                        data as DataExchangePayload['MOMO_PAYMENT']
                    );
                    break;
            }

            if (!nextScreenData) {
                throw new Error('Unhandled screen');
            }

            return {
                ...nextScreenData,
                version: requestBody.version,
            };
        }

        throw new Error('Unhandled action');
    }

    private static generateFiatToPayPattern(
        rate: number,
        currency: string,
        asset: AssetConfig,
        fiatAmount: number
    ) {
        return `${formatNumberAsCurrency(fiatAmount, currency)}${SECTION_SEPARATOR}1 ${asset.tokenName as TokenNames} = ${formatNumberAsCurrency(rate, currency)}` satisfies FiatToPayPattern;
    }

    private static generateTokenAmountPattern(
        amount: number,
        asset: AssetConfig,
        transactionFee: number
    ) {
        const tokenAmount: TokenAmountPattern = `${amount} ${asset.tokenName as TokenNames} (${asset.network})${SECTION_SEPARATOR}Fee = ${transactionFee} ${asset.tokenName as TokenNames}`;

        return tokenAmount;
    }

    private static determineSelectedPaymentMethod(
        payment_method: string,
        payment_methods: Array<DropdownOption>
    ) {
        const selectedPaymentMethod = payment_methods.find((type) => type.id === payment_method);

        if (!selectedPaymentMethod) {
            throw new Error('Invalid payment method');
        }

        return {
            paymentMethodTitle: selectedPaymentMethod.title,
            accountType: selectedPaymentMethod.title.toLowerCase().includes('bank')
                ? 'bank'
                : 'phone',
            channelId: selectedPaymentMethod.id,
        };
    }

    private static async getTransactionSummaryScreenData(
        input: DataExchangePayload['TRANSACTION_DETAILS']
    ) {
        const {
            amount,
            asset_id,
            payment_methods,
            payment_method,
            amount_denomination,
            local_currency,
            user_id,
            wallet_address,
            country_code,
        } = input;

        const assetConfig = getAssetConfigOrThrow(asset_id);

        const errorMessages: ScreenPayload['TRANSACTION_DETAILS']['error_messages'] = {};
        if (wallet_address && !validateWalletAddress(wallet_address, assetConfig.network)) {
            errorMessages.wallet_address = 'Invalid wallet address';
        }

        if (!amount.trim()) {
            errorMessages.amount = 'Amount is required';
        }

        if (Object.keys(errorMessages).length > 0) {
            const assetLabel = `${assetConfig.tokenName} (${assetConfig.network})`;
            return {
                screen: OnRampFlowScreens.TRANSACTION_DETAILS,
                data: {
                    dynamic_page_title: `Buy ${assetLabel} with ${getCountryFlagEmoji(country_code)} ${local_currency}`,
                    payment_methods,
                    asset_label: `${assetLabel}`,
                    asset_id,
                    user_id,
                    local_currency,
                    country_code,
                    amount_denomination_label: 'Provide amount in',
                    amount_denominations: [
                        {
                            id: assetConfig.tokenName,
                            title: assetConfig.tokenName,
                        },
                        {
                            id: local_currency,
                            title: local_currency,
                        },
                    ],
                    init_values: {
                        payment_method,
                        wallet_address,
                        amount,
                        amount_denomination: amount_denomination
                    },
                    error_messages: errorMessages,
                    amount_input_label: `Amount`,
                } satisfies ScreenPayload['TRANSACTION_DETAILS'],
            };
        }

        const [
            { rate: conversionRate, fee, rawFeePercentage },
            { countryFiatLimits: countryLimits },
        ] = await Promise.all([
            FiatRampService.getQuotes(local_currency, country_code as CountryCode, 'onramp'),
            FiatRampService.getPaymentMethods(country_code as CountryCode, 'onramp'),
        ]);

        const amountAsNumber = (amount_denomination === local_currency)
            ? fixNumber(math.divide(parseFloat(amount.trim()), conversionRate), 2)
            : parseFloat(amount.trim());
        const transactionFee = fixNumber(math.multiply(amountAsNumber, fee), 3);
        const totalAmount = fixNumber(math.add(amountAsNumber, transactionFee), 3);
        const fiatEquivalent = fixNumber(math.multiply(totalAmount, conversionRate), 2);

        if (amountAsNumber <= 0) {
            errorMessages.amount = 'Amount must be greater than 0';
        }

        const [minUsdLimit, maxUsdLimit] = [
            countryLimits.min / conversionRate,
            countryLimits.max / conversionRate,
        ];

        const [minLocalLimit, maxLocalLimit] = [
            countryLimits.min,
            countryLimits.max,
        ];

        const hardUsdLimit = getMinimumOnrampUsdAmount(assetConfig.network);
        const minUsdLimitUsed = hardUsdLimit ?? minUsdLimit;

        let minLocalLimitUsed: number;

        if (typeof hardUsdLimit === 'number' && typeof conversionRate === 'number') {
            minLocalLimitUsed = math.multiply(hardUsdLimit, conversionRate);
        } else {
            minLocalLimitUsed = minLocalLimit;
        }

        if (amountAsNumber < minUsdLimitUsed) {
            errorMessages.amount = (amount_denomination !== local_currency)
                ? `Amount must be greater than ${prettifyNumber(minUsdLimitUsed, TWO)} ${assetConfig.tokenName}`
                : `Amount must be greater than ${prettifyNumber(minLocalLimitUsed, TWO)} ${local_currency}`;
        }
        if (maxUsdLimit > 0 && amountAsNumber > maxUsdLimit) {
            errorMessages.amount = (amount_denomination !== local_currency)
                ? `Amount must be less than ${prettifyNumber(maxUsdLimit, TWO)} ${assetConfig.tokenName}`
                : `Amount must be less than ${prettifyNumber(maxLocalLimit, TWO)} ${local_currency}`;
        }

        /**
         * @dev This is duplicated down because, instead of waiting till this point to return an error, we want to break out as soon as we find an error, to avoid unnecessary API calls.
         * Usually it would make sense to do all the checks at once, but in this case, we want to avoid unnecessary API calls for quotes and limits, if the initial amount or wallet_address checks fail.
         * */
        if (Object.keys(errorMessages).length > 0) {
            const assetLabel = `${assetConfig.tokenName} (${assetConfig.network})`;
            return {
                screen: OnRampFlowScreens.TRANSACTION_DETAILS,
                data: {
                    dynamic_page_title: `Buy ${assetLabel} with ${getCountryFlagEmoji(country_code)} ${local_currency}`,
                    payment_methods,
                    asset_label: `${assetLabel}`,
                    asset_id,
                    user_id,
                    local_currency,
                    country_code,
                    amount_denomination_label: 'Provide amount in',
                    amount_denominations: [
                        {
                            id: assetConfig.tokenName,
                            title: assetConfig.tokenName,
                        },
                        {
                            id: local_currency,
                            title: local_currency,
                        },
                    ],
                    init_values: {
                        payment_method,
                        wallet_address,
                        amount,
                        amount_denomination: amount_denomination
                    },
                    error_messages: errorMessages,
                    amount_input_label: `Amount`,
                } satisfies ScreenPayload['TRANSACTION_DETAILS'],
            };
        }

        const token_amount: TokenAmountPattern = this.generateTokenAmountPattern(
            amountAsNumber,
            assetConfig,
            transactionFee
        );
        const fiat_to_pay: FiatToPayPattern = this.generateFiatToPayPattern(
            conversionRate,
            local_currency,
            assetConfig,
            fiatEquivalent
        );

        const selectedPaymentMethod = this.determineSelectedPaymentMethod(
            payment_method,
            payment_methods
        );

        return {
            screen: OnRampFlowScreens.TRANSACTION_SUMMARY,
            data: {
                display_data: {
                    token_amount,
                    fiat_to_pay,
                    payment_method: selectedPaymentMethod.paymentMethodTitle,
                },
                transaction_details: {
                    channel_id: selectedPaymentMethod.channelId,
                    token_amount: amount,
                    transaction_fee: transactionFee.toString(),
                    fiat_to_pay: fiatEquivalent.toString(),
                    external_wallet_address: wallet_address ?? '',
                    conversion_rate: conversionRate.toString(),
                    platform_fee_percentage: rawFeePercentage.toString(),
                },
                buying_to_external_wallet: !!wallet_address,
                asset_id,
                local_currency,
                user_id,
                country_code,
                account_type:
                    selectedPaymentMethod.accountType as OnrampTransactionPayload['accountType'],
            } satisfies ScreenPayload['TRANSACTION_SUMMARY'],
        };
    }

    private static async sendOnRampPaymentInstructions(params: { phoneNumber: string, accountNumber: string, fiatToPay: string }) {

        const { phoneNumber, accountNumber, fiatToPay } = params;

        await WhatsAppBotService.sendArbitraryTextMessage(
            phoneNumber,
            accountNumber
        );

        await WhatsAppBotService.sendArbitraryTextMessage(
            phoneNumber,
            fiatToPay
        );

        await WhatsAppBotService.sendArbitraryTextMessage(
            phoneNumber,
            `👆 *Long-press the account number or amount to copy.*\n\n🧾 Payment Instructions:\n\n 1. Please send the payment from *your own bank account*. \n\n 2. Make sure to send the *exact amount* to avoid any delays.`
        );
    }


    private static async getPaymentScreenData(input: DataExchangePayload['TRANSACTION_SUMMARY']) {
        const {
            asset_id,
            transaction_details,
            buying_to_external_wallet,
            local_currency,
            user_id,
            account_type,
            country_code,
        } = input;

        try {
            if (account_type === 'phone') {
                const mobileProviders = await FiatRampService.getSupportedMobileProviders(
                    country_code as CountryCode,
                    transaction_details.channel_id
                );

                return {
                    screen: OnRampFlowScreens.MOMO_PAYMENT,
                    data: {
                        asset_id,
                        amount: formatNumberAsCurrency(
                            parseFloat(transaction_details.token_amount),
                            local_currency
                        ),
                        local_currency,
                        mobile_money_providers: mobileProviders.map((provider) => ({
                            title: provider.name,
                            id: provider.networkId,
                        })),
                        channel_id: transaction_details.channel_id,
                        user_id,
                        transaction_details: transaction_details,
                        buying_to_external_wallet,
                        country_code,
                    } satisfies ScreenPayload['MOMO_PAYMENT'],
                };
            }

            if (account_type === 'bank') {
                if (buying_to_external_wallet) {
                    if (!transaction_details.external_wallet_address) {
                        return {
                            screen: OnRampFlowScreens.ERROR_FEEDBACK,
                            data: {
                                message: 'External wallet address is required',
                                status: 'failed',
                                asset_id,
                                is_on_ramp_transaction: true,
                                icon_src: ERROR_FEEDBACK_ICON,
                            } satisfies ScreenPayload['FEEDBACK_SCREEN'],
                        };
                    }

                    if (
                        !validateWalletAddress(
                            transaction_details.external_wallet_address,
                            getAssetConfigOrThrow(asset_id).network
                        )
                    ) {
                        return {
                            screen: OnRampFlowScreens.ERROR_FEEDBACK,
                            data: {
                                message: 'Invalid external wallet address',
                                status: 'failed',
                                asset_id,
                                is_on_ramp_transaction: true,
                                icon_src: ERROR_FEEDBACK_ICON,
                            } satisfies ScreenPayload['FEEDBACK_SCREEN'],
                        };
                    }
                }

                const assetConfig = getAssetConfigOrThrow(asset_id);
                const [assetWallet, verifiedUserDetails, fallbackRegionalPhoneNumber] =
                    await Promise.all([
                        azzaWalletManager.getUserWallet(user_id, assetConfig.network),
                        userServiceV2.getWhatsappUserIdentityInfo(user_id),
                        getFallBackRegionalPhoneNumber(user_id, country_code),
                    ]);

                if (!verifiedUserDetails) {
                    return {
                        screen: OnRampFlowScreens.ERROR_FEEDBACK,
                        data: {
                            message: 'You need to verify your identity to proceed',
                            status: 'failed',
                            asset_id,
                            is_on_ramp_transaction: true,
                            icon_src: ERROR_FEEDBACK_ICON,
                        } satisfies ScreenPayload['FEEDBACK_SCREEN'],
                    };
                }

                if (fallbackRegionalPhoneNumber) {
                    verifiedUserDetails.phoneNumber = fallbackRegionalPhoneNumber;
                }

                const onrampResponse = await FiatRampService.postOnRampTransaction({
                    accountType: account_type,
                    userWalletAddress: buying_to_external_wallet
                        ? transaction_details.external_wallet_address
                        : assetWallet.address,
                    localAmount: parseFloat(transaction_details.fiat_to_pay),
                    tokenName: assetConfig.tokenName,
                    chainName: assetConfig.network.toUpperCase(),
                    channelId: transaction_details.channel_id,
                    country: country_code,
                    userDetails: verifiedUserDetails,
                    customerId: user_id,
                    platformFeePercentage: parseFloat(transaction_details.platform_fee_percentage),
                    conversionRate: parseFloat(transaction_details.conversion_rate),
                    usdAmount: parseFloat(transaction_details.token_amount),
                    transactionFeeUsd: parseFloat(transaction_details.transaction_fee),
                });

                if (onrampResponse.bankInfo === undefined) {
                    return {
                        screen: OnRampFlowScreens.ERROR_FEEDBACK,
                        data: {
                            message: 'Failed to retrieve payment details',
                            status: 'failed',
                            asset_id,
                            is_on_ramp_transaction: true,
                            icon_src: ERROR_FEEDBACK_ICON,
                        } satisfies ScreenPayload['FEEDBACK_SCREEN'],
                    };
                }

                const message = generateOnrampTransactionInitiatedMessage({
                    tokenAmount: transaction_details.token_amount,
                    assetNetwork: assetConfig.network,
                    assetName: assetConfig.tokenName,
                    bankInfo: onrampResponse.bankInfo,
                    localCurrency: local_currency,
                    fiatToPay: transaction_details.fiat_to_pay,
                });

                //send transaction initiated message
                await WhatsAppBotService.sendArbitraryTextMessage(
                    verifiedUserDetails.phoneNumber,
                    message
                );

                //send payment instruction message
                await this.sendOnRampPaymentInstructions({
                    phoneNumber: verifiedUserDetails.phoneNumber,
                    accountNumber: onrampResponse.bankInfo.accountNumber,
                    fiatToPay: prettifyNumber(parseFloat(transaction_details.fiat_to_pay))
                })

                return {
                    screen: OnRampFlowScreens.PROCESSING_FEEDBACK,
                    data: {
                        message:
                            'Your transaction is being processed, please check your DM for the account number and amount to send ,we will notify you once the transaction is complete',
                        status: 'processing',
                        asset_id,
                        is_on_ramp_transaction: true,
                        icon_src: SUCCESS_FEEDBACK_ICON,
                    } satisfies ScreenPayload['FEEDBACK_SCREEN'],
                };
            }
        } catch (error) {
            await logServiceError(error, 'An error occurred while processing on-ramp transaction');

            return {
                screen: OnRampFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: 'An unexpected error occurred',
                    status: 'failed',
                    asset_id,
                    is_on_ramp_transaction: true,
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenPayload['FEEDBACK_SCREEN'],
            };
        }
    }

    private static async getBankPaymentFeedbackScreenData(
        input: DataExchangePayload['BANK_PAYMENT']
    ) {
        const { asset_id, sequence_id } = input;

        try {
            const transactionStatus = await FiatRampService.getTransactionStatus(
                sequence_id,
                'onramp'
            );

            if (transactionStatus === 'failed') {
                return {
                    screen: OnRampFlowScreens.ERROR_FEEDBACK,
                    data: {
                        message:
                            'Transaction failed, If you were debited, expect a refund within 24 hours',
                        status: 'failed',
                        asset_id,
                        is_on_ramp_transaction: true,
                        icon_src: ERROR_FEEDBACK_ICON,
                    } satisfies ScreenPayload['FEEDBACK_SCREEN'],
                };
            }

            return {
                screen: OnRampFlowScreens.PROCESSING_FEEDBACK,
                data: {
                    message:
                        'Your transaction is being processed, we will notify you once the transaction is complete',
                    status: 'processing',
                    asset_id,
                    is_on_ramp_transaction: true,
                    icon_src: SUCCESS_FEEDBACK_ICON,
                } satisfies ScreenPayload['FEEDBACK_SCREEN'],
            };
        } catch (error) {
            await logServiceError(
                error,
                'An error occurred while processing bank onramp transaction'
            );

            return {
                screen: OnRampFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: 'An unexpected error occurred',
                    status: 'failed',
                    asset_id,
                    is_on_ramp_transaction: true,
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenPayload['FEEDBACK_SCREEN'],
            };
        }
    }

    private static async getMomoPaymentFeedbackScreenData(
        input: DataExchangePayload['MOMO_PAYMENT']
    ) {
        const {
            asset_id,
            channel_id,
            mobile_number,
            mobile_provider,
            user_id,
            country_code,
            transaction_details,
            buying_to_external_wallet,
            local_currency,
            mobile_providers,
        } = input;

        if (buying_to_external_wallet) {
            if (!transaction_details.external_wallet_address) {
                return {
                    screen: OnRampFlowScreens.ERROR_FEEDBACK,
                    data: {
                        message: 'External wallet address is required',
                        status: 'failed',
                        asset_id,
                        is_on_ramp_transaction: true,
                        icon_src: ERROR_FEEDBACK_ICON,
                    } satisfies ScreenPayload['FEEDBACK_SCREEN'],
                };
            }

            if (
                !validateWalletAddress(
                    transaction_details.external_wallet_address,
                    getAssetConfigOrThrow(asset_id).network
                )
            ) {
                return {
                    screen: OnRampFlowScreens.ERROR_FEEDBACK,
                    data: {
                        message: 'Invalid external wallet address',
                        status: 'failed',
                        asset_id,
                        is_on_ramp_transaction: true,
                        icon_src: ERROR_FEEDBACK_ICON,
                    } satisfies ScreenPayload['FEEDBACK_SCREEN'],
                };
            }
        }

        try {
            const assetConfig = getAssetConfigOrThrow(asset_id);
            const [assetWallet, verifiedUserDetails] = await Promise.all([
                azzaWalletManager.getUserWallet(user_id, getAssetConfigOrThrow(asset_id).network),
                userServiceV2.getWhatsappUserIdentityInfo(user_id),
            ]);

            if (!verifiedUserDetails) {
                return {
                    screen: OnRampFlowScreens.ERROR_FEEDBACK,
                    data: {
                        message: 'You need to verify your identity to proceed',
                        status: 'failed',
                        asset_id,
                        is_on_ramp_transaction: true,
                        icon_src: ERROR_FEEDBACK_ICON,
                    } satisfies ScreenPayload['FEEDBACK_SCREEN'],
                };
            }

            const [standardPhoneNumber, error] = standardizePhoneNumberOrReturnError(
                mobile_number,
                country_code as CountryCode
            );

            if (error !== null) {
                return {
                    screen: OnRampFlowScreens.MOMO_PAYMENT,
                    data: {
                        asset_id,
                        amount: formatNumberAsCurrency(
                            parseFloat(transaction_details.token_amount),
                            local_currency
                        ),
                        local_currency,
                        mobile_money_providers: mobile_providers,
                        channel_id: transaction_details.channel_id,
                        user_id,
                        transaction_details: transaction_details,
                        buying_to_external_wallet,
                        country_code,
                        error_messages: {
                            mobile_number: error.message,
                        },
                        init_values: {
                            mobile_provider: mobile_provider,
                            first_name: verifiedUserDetails.firstName,
                            last_name: verifiedUserDetails.lastName,
                            mobile_number: mobile_number,
                        },
                    } satisfies ScreenPayload['MOMO_PAYMENT'],
                };
            }

            await FiatRampService.postOnRampTransaction({
                channelId: channel_id,
                accountNumber: standardPhoneNumber,
                accountType: 'phone',
                country: country_code,
                networkId: mobile_provider,
                userDetails: verifiedUserDetails,
                userWalletAddress: buying_to_external_wallet
                    ? transaction_details.external_wallet_address
                    : assetWallet.address,
                localAmount: parseFloat(transaction_details.fiat_to_pay),
                chainName: assetConfig.network.toUpperCase(),
                tokenName: assetConfig.tokenName,
                customerId: user_id,
                platformFeePercentage: parseFloat(transaction_details.platform_fee_percentage),
                conversionRate: parseFloat(transaction_details.conversion_rate),
                usdAmount: parseFloat(transaction_details.token_amount),
                transactionFeeUsd: parseFloat(transaction_details.transaction_fee),
            });

            const accountName =
                verifiedUserDetails.firstName +
                (verifiedUserDetails.lastName ? ' ' + verifiedUserDetails.lastName : '');

            const message = generateOnrampTransactionInitiatedWithMomoPaymentMessage({
                tokenAmount: transaction_details.token_amount,
                assetName: assetConfig.tokenName,
                assetNetwork: assetConfig.network,
                fiatToPay: transaction_details.fiat_to_pay,
                localCurrency: local_currency,
                momoDetails: {
                    accountName: accountName,
                    accountNumber: standardPhoneNumber,
                    name: mobile_provider,
                },
            });

            void WhatsAppBotService.sendArbitraryTextMessage(
                verifiedUserDetails.phoneNumber,
                message
            );

            return {
                screen: OnRampFlowScreens.PROCESSING_FEEDBACK,
                data: {
                    message:
                        'Follow the instructions on your phone to complete the transaction, we will notify you once the transaction is complete',
                    status: 'pending',
                    asset_id,
                    is_on_ramp_transaction: true,
                    icon_src: SUCCESS_FEEDBACK_ICON,
                } satisfies ScreenPayload['FEEDBACK_SCREEN'],
            };
        } catch (error) {
            await logServiceError(
                error,
                'An error occurred while processing mobile money onramp transaction'
            );

            return {
                screen: OnRampFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: 'An unexpected error occurred',
                    status: 'failed',
                    asset_id,
                    is_on_ramp_transaction: true,
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenPayload['FEEDBACK_SCREEN'],
            };
        }
    }

    public static generateOnRampFlowInitMessage(
        user: UserV2Record,
        params: {
            asset: AssetConfig;
            localCurrency: string;
            countryCode: string;
            recipient: string;
            paymentMethods: Array<DropdownOption>;
        }
    ) {
        const { asset, localCurrency, recipient, paymentMethods, countryCode } = params;

        const assetLabel = `${asset.tokenName} (${asset.network})`;
        const buyMessage = `To buy ${assetLabel} with ${getCountryFlagEmoji(countryCode)} ${localCurrency}, tap "Proceed" to enter payment method and amount`;

        const flowMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'flow',
                body: {
                    text: buyMessage,
                },
                action: {
                    name: 'flow',
                    parameters: {
                        flow_message_version: '3',
                        flow_token: generateRandomHexString(SIXTEEN),
                        flow_id: this.FLOW_ID,
                        mode: this.FLOW_MODE,
                        flow_cta: 'Proceed',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: this.INITIAL_SCREEN,
                            data: {
                                dynamic_page_title: buyMessage,
                                asset_label: assetLabel,
                                asset_id: asset.listItemId,
                                user_id: user.id,
                                local_currency: localCurrency,
                                payment_methods: paymentMethods,
                                country_code: countryCode,
                                amount_denomination_label: 'Provide amount in',
                                amount_denominations: [
                                    {
                                        id: asset.tokenName,
                                        title: asset.tokenName,
                                    },
                                    {
                                        id: localCurrency,
                                        title: localCurrency,
                                    },
                                ],
                                init_values: {
                                    payment_method: paymentMethods[0].id,
                                    amount_denomination: asset.tokenName
                                },
                                amount_input_label: `Amount`,
                            } satisfies ScreenPayload['TRANSACTION_DETAILS'],
                        },
                    },
                },
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipient,
        };

        return flowMessage;
    }

    public static previewInitializationFlow(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ) {
        const data = {
            dynamic_page_title: 'Buy USDT (Polygon) with NGN',
            asset_label: 'USDT (Polygon)',
            asset_id: 'usdt-polygon',
            user_id: '1234567890',
            local_currency: 'NGN',
            payment_methods: [
                {
                    title: 'Bank Transfer',
                    id: 'bank_transfer',
                },
                {
                    title: 'Mobile Money',
                    id: 'mobile_money',
                },
            ],
            amount_denomination_label: 'Provide amount in',
            amount_denominations: [
                {
                    id: 'NGN',
                    title: 'NGN',
                },
                {
                    id: 'USDT',
                    title: 'USDT',
                },
            ],
            country_code: 'NG',
            init_values: {
                payment_method: 'bank_transfer',
                amount_denomination: 'USDT',
            },
            amount_input_label: 'Amount',
        } satisfies ScreenPayload['TRANSACTION_DETAILS'];

        return {
            screen: OnRampFlowScreens.TRANSACTION_DETAILS,
            data,
            version: requestBody.version,
        };
    }
}

export default WhatsAppBotOnRampFlowService;
