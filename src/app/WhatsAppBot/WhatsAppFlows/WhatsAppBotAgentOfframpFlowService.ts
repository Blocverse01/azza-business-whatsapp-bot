import env from "@/constants/env";
import { DropdownOption, FlowMode } from "./types";
import { getFlowConfig } from "./config";
import { convertAsciiStringToBase64, encryptWithAES, generateRandomHexString } from "@/resources/utils/encryption";
import { DataExchangeResponse, DecryptedFlowDataExchange, WhatsAppInteractiveMessage } from "../WhatsAppBotType";
import { AssetConfig, TokenNames } from "@/resources/web3/core/tokens";
import { FOUR, SIXTEEN, THREE, TWO, ZERO } from "@/constants/numbers";
import WhatsAppBotFlowService from "./WhatsAppBotFlowService";
import FiatRampService from "@/app/FiatRamp/FiatRampService";
import { CountryCode } from "libphonenumber-js";
import { extractIdFromString } from "./schema";
import { toTitleCase } from "@/resources/utils/transformers";
import { AllSupportedBlockchains } from "@/resources/web3/core/blockchains";
import azzaWalletManager from "@/runtime/wallet";
import { getMinimumOfframpUsdAmount } from "@/app/FiatRamp/config";
import * as math from 'mathjs';
import { decimalToString, defaultAmountFixer, fixNumber, formatNumberAsCurrency, getCountryFlagEmoji, prettifyNumber } from "@/resources/utils/currency";
import { getTokenToCurrencyConversionRate, isPeggedCurrency } from "@/app/FiatRamp/token-currency-pair-rate/utils";
import userServiceV2 from "@/runtime/user";
import { standardizePhoneNumberOrReturnError } from "@/resources/utils/phone-numbers";
import { ERROR_FEEDBACK_ICON, SUCCESS_FEEDBACK_ICON } from "@/constants/feeback-icons";
import { compareHashedString } from "@/resources/utils/hashing";
import { getAssetConfigOrThrow } from "@/config/whatsAppBot";
import WhatsAppBotService from "../WhatsAppBotService";
import { generateOfframpProcessingMessage } from "@/resources/utils/bot-message-utils";
import { logServiceError } from "@/resources/requestHelpers/handleRequestError";
import { defaultQueueRemoveOptions, queues } from "@/background-processing/queues";
import { BankBeneficiaryType, PhoneBeneficiaryType } from "@/app/FiatRamp/fiatRampSchema";


enum AgentOfframpFlowScreens {
    ACCOUNT_TYPE = 'ACCOUNT_TYPE',
    BANK_ACCOUNT_FORM = 'BANK_ACCOUNT_FORM',
    BANK_ACCOUNT_SUMMARY = 'BANK_ACCOUNT_SUMMARY',
    MOBILE_MONEY_FORM = 'MOBILE_MONEY_FORM',
    AMOUNT_INPUT = 'AMOUNT_INPUT',
    TRANSACTION_SUMMARY = 'TRANSACTION_SUMMARY',
    PROCESSING_FEEDBACK = 'PROCESSING_FEEDBACK',
    ERROR_FEEDBACK = 'ERROR_FEEDBACK',
}

type ScreenDataPayload = {
    ACCOUNT_TYPE_SCREEN: {
        account_types: Array<DropdownOption>;
        asset_id: string;
        user_id: string;
        country_code: string;
        currency: string;
    };
    BANK_ACCOUNT_FORM_SCREEN: {
        country_code: string;
        currency: string;
        channel_id: string;
        asset_id: string;
        user_id: string;
        supported_banks: Array<DropdownOption>;
        can_edit_account_name: boolean;
        init_values?: {
            bank?: string;
            account_name?: string;
            account_number?: string;
        };
        resolved_account_name?: string;
        button_label: string;
        button_id: string;
        has_resolved_account_name: boolean;
        error_messages?: {
            account_number?: string;
        };
    };
    MOBILE_MONEY_FORM_SCREEN: {
        supported_mobile_providers: Array<DropdownOption>;
        country_code: string;
        currency: string;
        channel_id: string;
        asset_id: string;
        user_id: string;
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
    AMOUNT_INPUT: {
        dynamic_page_title: string;
        asset_label: string;
        asset_id: string;
        user_id: string;
        beneficiary: DataExchangePayload['AMOUNT_INPUT']['beneficiary'];
        amount_denominations: Array<DropdownOption>;
        init_values?: {
            amount?: string;
            amount_denomination: string;
        };
        user_balance: string;
        amount_denomination_label: string;
        error_messages?: {
            amount?: string;
        };
        conversion_rate: string;
        fee: string;
    },
    SUCCESS_FEEDBACK_SCREEN: {
        message: string;
        beneficiary_id: string;
        asset_id: string;
        icon_src: string;
    };
    ERROR_FEEDBACK_SCREEN: {
        title: string;
        message: string;
        icon_src: string;
    };
};

type DataExchangePayload = {
    ACCOUNT_TYPE_SCREEN: {
        account_type: string;
        account_types: Array<DropdownOption>;
        asset_id: string;
        user_id: string;
        country_code: string;
        currency: string;
    };
    BANK_ACCOUNT_FORM_SCREEN: {
        country_code: string;
        currency: string;
        channel_id: string;
        bank: string;
        account_name: string;
        account_number: string;
        asset_id: string;
        user_id: string;
        supported_banks: Array<DropdownOption>;
        can_edit_account_name: boolean;
        resolved_account_name?: string;
        button_id: string;
        has_resolved_account_name: boolean;
    };
    MOBILE_MONEY_FORM_SCREEN: {
        supported_mobile_providers: Array<Required<DropdownOption>>;
        country_code: string;
        currency: string;
        channel_id: string;
        mobile_provider: string;
        first_name: string;
        last_name: string;
        mobile_number: string;
        asset_id: string;
        user_id: string;
    };
    AMOUNT_INPUT: {
        amount: string;
        asset_id: string;
        user_id: string;
        beneficiary: {
            account_type: 'phone' | 'bank';
            account_name: string;
            account_number: string;
            provider_name: string;
            currency_symbol: string;
            country_code: string;
            channel_id?: string;
            network_id?: string;
        };
        amount_denomination: string;
        asset_label: string;
        conversion_rate: string;
        fee: string;
    },
    TRANSACTION_SUMMARY: {
        asset_id: string;
        token_amount_to_debit: string;
        token_amount: string;
        user_id: string;
        fiat_to_receive: string;
        transaction_fee: string;
        usd_amount: string;
        transaction_fee_usd: string;
        conversion_rate: string;
        platform_fee_percentage: string;
        fiat_currency: string;
        transaction_pin: string;
        beneficiary: {
            id: string;
            account_type: 'phone' | 'bank',
            account_name: string;
            account_number: string;
            provider_name: string;
            currency_symbol: string;
            country_code: string;
            channel_id?: string;
            network_id?: string;
        }
    },
    SUCCESS_FEEDBACK_SCREEN: {
        message: string;
        beneficiary_id: string;
        asset_id: string;
    };
};

type TokenAmountPattern =
    `${string} ${TokenNames} (${AllSupportedBlockchains})\n---------------------------------\nFee = ${string} ${TokenNames}`;
type TokenAmountToDebitPattern = `${number} ${TokenNames}`;
type DestinationPattern = `${string} | ${string} | ${string}`;
type FiatToReceivePattern =
    `${string}\n---------------------------------\n1 ${TokenNames} = ${string}`;

const SECTION_SEPARATOR = '\n---------------------------------\n' as const;

type ProcessOfframpTransactionParams = {
    fiatAmount: number;
    userId: string;
    assetId: string;
    usdAmount: number;
    tokenAmountToDebit: number;
    beneficiaryId: string;
    platformFeePercentage: number;
    conversionRate: number;
    transactionPin: string;
    transactionFeeUsd: number;
};
type ProcessOffRampTransactionResponse = {
    status: 'processing' | 'complete' | 'failed' | 'pending';
    message: string;
};

const flowConfig = getFlowConfig('AGENT_OFFRAMP', env.WA_PHONE_NUMBER_ID);

class WhatsAppBotAgentOffRampFlowService {
    private static FLOW_MODE: FlowMode = flowConfig.flowMode;
    public static readonly FLOW_ID = flowConfig.flowId;
    private static INITIAL_SCREEN = AgentOfframpFlowScreens.ACCOUNT_TYPE;

    public static async receiveDataExchange(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ): Promise<DataExchangeResponse> {
        const { screen, data, action, flow_token } = requestBody;

        if (action === 'data_exchange') {
            let nextScreenData: Omit<DataExchangeResponse, 'version'> | undefined;

            switch (screen) {
                case AgentOfframpFlowScreens.ACCOUNT_TYPE:
                    const typedData = data as DataExchangePayload['ACCOUNT_TYPE_SCREEN'];
                    const selectedAccountType = WhatsAppBotFlowService.determineSelectedAccountType(
                        typedData.account_type,
                        typedData.account_types
                    );

                    if (selectedAccountType.accountType === 'bank') {
                        nextScreenData = await this.getBankAccountFormScreenData(typedData);
                    } else {
                        nextScreenData = await this.getMobileMoneyAccountFormScreenData(typedData);
                    }

                    break;

                case AgentOfframpFlowScreens.BANK_ACCOUNT_FORM:
                    nextScreenData = await this.handleDataExchangeFromBankAccountFormScreen(
                        data as DataExchangePayload['BANK_ACCOUNT_FORM_SCREEN']
                    );
                    break;
                case AgentOfframpFlowScreens.MOBILE_MONEY_FORM:
                    nextScreenData = await this.handleDataExchangeFromMobileMoneyFormScreen(
                        data as DataExchangePayload['MOBILE_MONEY_FORM_SCREEN']
                    );
                    break
                case AgentOfframpFlowScreens.AMOUNT_INPUT:
                    nextScreenData =
                        await this.handleDataExchangeFromAmountInputScreen(
                            data as DataExchangePayload['AMOUNT_INPUT']
                        );
                    break;
                case AgentOfframpFlowScreens.TRANSACTION_SUMMARY:
                    nextScreenData = await this.getFeedbackScreenData(
                        data as DataExchangePayload['TRANSACTION_SUMMARY'],
                        flow_token
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

    public static generateAgentOfframpFlowInitMessage(params: {
        asset: AssetConfig;
        userId: string;
        countryCode: string;
        currency: string;
        recipient: string;
        accountTypes: Array<DropdownOption>;
        bodyText?: string;
    }) {
        const { asset, userId, countryCode, currency, recipient, accountTypes } = params;

        const flowMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'flow',
                body: {
                    text: `You are about to initiate a payment to a beneficiary.`,
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
                                account_types: accountTypes,
                                asset_id: asset.listItemId,
                                user_id: userId,
                                country_code: countryCode,
                                currency: currency
                            } satisfies ScreenDataPayload['ACCOUNT_TYPE_SCREEN'],
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

    private static async getBankAccountFormScreenData(
        input: DataExchangePayload['ACCOUNT_TYPE_SCREEN']
    ) {
        const { account_types, account_type, asset_id, user_id, country_code, currency } = input;

        const selectedAccountType = WhatsAppBotFlowService.determineSelectedAccountType(account_type, account_types);

        const supportedBanks = await FiatRampService.getSupportedBanks(
            country_code as CountryCode,
            selectedAccountType.channelId
        );

        const canEditAccountName =
            !FiatRampService.supportedCountriesForResolvingBankAccount.includes(
                country_code.toUpperCase()
            );

        return {
            screen: AgentOfframpFlowScreens.BANK_ACCOUNT_FORM,
            data: {
                supported_banks: supportedBanks.map((bank) => ({
                    title: toTitleCase(bank.name),
                    id:
                        country_code === 'NG'
                            ? `networkId:${bank.networkId}:seerbitId:${bank.seerbitId}`
                            : `${bank.networkId}`,
                })),
                country_code,
                currency,
                channel_id: selectedAccountType.channelId,
                asset_id,
                user_id,
                can_edit_account_name: canEditAccountName,
                button_id: canEditAccountName ? 'continue' : 'verify',
                has_resolved_account_name: false,
                button_label: canEditAccountName ? 'Continue' : 'Verify Account Details',
            } satisfies ScreenDataPayload['BANK_ACCOUNT_FORM_SCREEN'],
        };
    }

    private static async getMobileMoneyAccountFormScreenData(
        input: DataExchangePayload['ACCOUNT_TYPE_SCREEN']
    ) {
        const { account_types, account_type, asset_id, user_id, country_code, currency } = input;

        const selectedAccountType = WhatsAppBotFlowService.determineSelectedAccountType(account_type, account_types);

        const supportedProviders = await FiatRampService.getSupportedMobileProviders(
            country_code as CountryCode,
            selectedAccountType.channelId
        );

        return {
            screen: AgentOfframpFlowScreens.MOBILE_MONEY_FORM,
            data: {
                supported_mobile_providers: supportedProviders.map((provider) => ({
                    title: provider.name,
                    id: provider.networkId,
                    description: provider.name,
                })),
                country_code,
                currency,
                channel_id: selectedAccountType.channelId,
                asset_id,
                user_id,
            } satisfies ScreenDataPayload['MOBILE_MONEY_FORM_SCREEN'],
        };
    }


    private static async handleDataExchangeFromBankAccountFormScreen(
        input: DataExchangePayload['BANK_ACCOUNT_FORM_SCREEN']
    ) {
        const {
            country_code,
            currency,
            channel_id,
            bank,
            account_name,
            account_number,
            asset_id,
            user_id,
            supported_banks,
            can_edit_account_name,
            has_resolved_account_name,
            button_id
        } = input;


        const selectedBank = WhatsAppBotFlowService.determineSelectedBank(bank, supported_banks);

        let resolvedBankAccount: Awaited<ReturnType<typeof FiatRampService.resolveBankAccount>> =
            null;

        const networkId = country_code === 'NG'
            ? extractIdFromString({ input: selectedBank.networkId, key: 'networkId' })
            : selectedBank.networkId;

        const seerbitId = country_code === 'NG'
            ? extractIdFromString({ input: selectedBank.networkId, key: 'seerbitId' })
            : '';

        if (
            !can_edit_account_name &&
            FiatRampService.supportedCountriesForResolvingBankAccount.includes(
                country_code.toUpperCase()
            )
        ) {
            resolvedBankAccount = await FiatRampService.resolveBankAccount({
                networkId: networkId,
                accountNumber: account_number.trim(),
                seerbitId: seerbitId,
                countryCode: country_code.toUpperCase(),
            });
        }

        if (button_id === 'continue') {

            return await this.getAmountInputScreenDate({
                amount: '0',
                asset_id,
                beneficiary: {
                    account_type: 'bank',
                    account_name: resolvedBankAccount?.accountName ?? account_name,
                    account_number: resolvedBankAccount?.accountNumber ?? account_number,
                    provider_name: selectedBank.bankName,
                    currency_symbol: currency,
                    country_code: country_code,
                    channel_id: channel_id,
                    network_id: networkId
                },
                user_id: user_id,
                amount_denomination: '',
                conversion_rate: '',
                fee: '',
                asset_label: ''
            })
        }

        if ((!resolvedBankAccount || !resolvedBankAccount.accountName) && !account_name) {
            return {
                screen: AgentOfframpFlowScreens.BANK_ACCOUNT_FORM,
                data: {
                    country_code,
                    currency,
                    channel_id,
                    asset_id,
                    user_id,
                    supported_banks,
                    can_edit_account_name: false,
                    error_messages: {
                        account_number: `Invalid account number for ${selectedBank.bankName}`,
                    },
                    button_label: 'Verify Account Details',
                    button_id: 'verify',
                    has_resolved_account_name: false,
                    init_values: {
                        bank,
                        account_name,
                        account_number,
                    },
                } satisfies ScreenDataPayload['BANK_ACCOUNT_FORM_SCREEN'],
            };
        }

        return {
            screen: AgentOfframpFlowScreens.BANK_ACCOUNT_FORM,
            data: {
                country_code,
                currency,
                channel_id,
                asset_id,
                user_id,
                supported_banks,
                can_edit_account_name: can_edit_account_name,
                button_label: 'Continue',
                error_messages: {
                    account_number: ``,
                },
                button_id: 'continue',
                has_resolved_account_name: true,
                resolved_account_name: !can_edit_account_name ? `Account Name : \n ${toTitleCase(resolvedBankAccount?.accountName ?? account_name)}` : '',
                init_values: {
                    bank,
                    account_name,
                    account_number,
                },
            } satisfies ScreenDataPayload['BANK_ACCOUNT_FORM_SCREEN'],
        };
    }

    private static async handleDataExchangeFromMobileMoneyFormScreen(input: DataExchangePayload['MOBILE_MONEY_FORM_SCREEN']) {

        const {
            supported_mobile_providers,
            country_code,
            currency,
            channel_id,
            mobile_provider,
            first_name,
            last_name,
            mobile_number,
            asset_id,
            user_id,
        } = input;


        const selectedMobileProvider = WhatsAppBotFlowService.determineSelectedMobileProvider(
            mobile_provider,
            supported_mobile_providers
        );

        const supportedCountries = await FiatRampService.getSupportedCurrencies();
        const country = supportedCountries.find((country) => country.code === country_code);

        if (!country) {
            throw new Error('Invalid country code');
        }

        const [standardPhoneNumber, error] = standardizePhoneNumberOrReturnError(
            mobile_number,
            country.code.toUpperCase() as CountryCode
        );

        if (error !== null) {
            return {
                screen: AgentOfframpFlowScreens.MOBILE_MONEY_FORM,
                data: {
                    supported_mobile_providers: supported_mobile_providers,
                    country_code,
                    currency,
                    channel_id: channel_id,
                    asset_id,
                    user_id,
                    error_messages: {
                        mobile_number: error.message,
                    },
                    init_values: {
                        mobile_provider,
                        first_name,
                        last_name,
                        mobile_number,
                    },
                } satisfies ScreenDataPayload['MOBILE_MONEY_FORM_SCREEN'],
            };
        }

        return await this.getAmountInputScreenDate({
            amount: '0',
            asset_id,
            beneficiary: {
                account_type: 'phone',
                account_name: `${first_name} ${last_name}`,
                account_number: standardPhoneNumber,
                provider_name: selectedMobileProvider.providerName,
                currency_symbol: currency,
                country_code: country_code,
                channel_id: channel_id,
                network_id: selectedMobileProvider.networkId
            },
            user_id: user_id,
            amount_denomination: '',
            conversion_rate: '',
            fee: '',
            asset_label: ''
        })
    }


    private static async getAmountInputScreenDate(input: DataExchangePayload['AMOUNT_INPUT']) {

        const { asset_id, user_id, beneficiary } = input

        const [userV2] = await Promise.all([
            userServiceV2.getWhatsappUserByPhoneNumber(user_id)
        ]);

        const [assetBalance] = await Promise.all([
            azzaWalletManager.getAssetBalance({
                assetId: asset_id,
                userId: userV2?.id!,
            })
        ]);

        const { balance: userBalance, asset } = assetBalance;
        const assetLabel = `${asset.tokenName} (${asset.network})`;

        const { rate, fee } = await FiatRampService.getQuotes(
            beneficiary.currency_symbol,
            beneficiary.country_code as CountryCode,
            'offramp'
        );

        const sellMessage = `Enter Amount`;

        const userBalanceFormatted = prettifyNumber(userBalance, 6) + ' ' + asset.tokenName;

        const userBalanceInFiat = formatNumberAsCurrency(
            fixNumber(userBalance * rate, THREE),
            beneficiary.currency_symbol
        );

        const userBalanceMessage = `Your balance:\n${userBalanceFormatted} (${userBalanceInFiat})`;

        return {
            screen: AgentOfframpFlowScreens.AMOUNT_INPUT,
            data: {
                dynamic_page_title: sellMessage,
                asset_label: assetLabel,
                asset_id: asset.listItemId,
                user_id,
                beneficiary: beneficiary,
                amount_denomination_label: 'Provide amount in',
                amount_denominations: [
                    {
                        id: asset.tokenName,
                        title: asset.tokenName,
                    },
                    {
                        id: beneficiary.currency_symbol,
                        title: beneficiary.currency_symbol,
                    },
                ],
                user_balance: userBalanceMessage,
                conversion_rate: rate.toString(),
                fee: fee.toString(),
                init_values: {
                    amount_denomination: asset.tokenName,
                }
            } satisfies ScreenDataPayload['AMOUNT_INPUT']
        };

    }

    private static async handleDataExchangeFromAmountInputScreen(
        input: DataExchangePayload['AMOUNT_INPUT']
    ) {
        const {
            amount,
            asset_id,
            beneficiary,
            user_id,
            amount_denomination,
            conversion_rate,
            fee: feeString,
        } = input;

        console.log(input, 'handleDataExchangeFromAmountInputScreen')

        const [{ countryFiatLimits: countryLimits }, assetBalance, quotes] = await Promise.all([
            FiatRampService.getPaymentMethods(beneficiary.country_code as CountryCode, 'offramp'),
            azzaWalletManager.getAssetBalance({
                userId: user_id,
                assetId: asset_id,
            }),
            FiatRampService.getQuotes(
                beneficiary.currency_symbol,
                beneficiary.country_code as CountryCode,
                'offramp'
            ),
        ]);

        const assetConfig = assetBalance.asset;
        const [usdToFiatConversionRate, amountAsNumber] = [
            parseFloat(conversion_rate),
            parseFloat(amount.trim()),
        ];
        const cryptoToFiatConversionRate = await getTokenToCurrencyConversionRate(
            assetConfig.tokenName,
            beneficiary.currency_symbol,
            usdToFiatConversionRate
        );
        const cryptoToUsdConversionRate = usdToFiatConversionRate / cryptoToFiatConversionRate;

        const tradingAmountInToken =
            amount_denomination === beneficiary.currency_symbol
                ? amountAsNumber / cryptoToFiatConversionRate
                : amountAsNumber; // 10 USDT, 10000 CNGN
        const tradingAmountInFiat =
            amount_denomination === beneficiary.currency_symbol
                ? amountAsNumber
                : amountAsNumber * cryptoToFiatConversionRate;
        const tradingAmountInUsd = tradingAmountInToken / cryptoToUsdConversionRate;

        const [minLimit, maxLimit] = [
            amount_denomination === beneficiary.currency_symbol
                ? countryLimits.min
                : (() => {
                    const cryptoMin = countryLimits.min / cryptoToFiatConversionRate;
                    const usdLimit = countryLimits.min / usdToFiatConversionRate;

                    const feeForUsdLimit = FiatRampService.calculateTransactionFeeUsd({
                        usdAmount: usdLimit,
                        conditionalFeePercentageConfigs: quotes.conditionalFeePercentConfigs,
                        minFeeUsd: quotes.minFeeUsd,
                        defaultFeePercentage: quotes.rawFeePercentage,
                        rampType: 'offramp',
                    });

                    if (isPeggedCurrency(assetConfig.tokenName, beneficiary.currency_symbol)) {
                        // Assume that the usd->fiat conversion rate is the same as the usd->crypto conversion rate
                        const feeInCrypto = feeForUsdLimit.feeUsd * cryptoToUsdConversionRate;

                        return fixNumber(cryptoMin + feeInCrypto, TWO);
                    }

                    return fixNumber(usdLimit + feeForUsdLimit.feeUsd + 0.1, TWO);
                })(),
            amount_denomination === beneficiary.currency_symbol
                ? countryLimits.max
                : countryLimits.max / cryptoToFiatConversionRate,
        ];

        // Asset Config
        const { asset, blockchainNetwork: assetNetwork, balance: userBalance } = assetBalance;
        const assetName = asset.tokenName as TokenNames;

        const errorMessages: ScreenDataPayload['AMOUNT_INPUT']['error_messages'] = {};

        if (tradingAmountInToken <= 0) {
            errorMessages.amount = 'Amount must be greater than 0';
        }

        const hardCappedMinUsdLimit = getMinimumOfframpUsdAmount(assetNetwork);
        const minLimitToUse = hardCappedMinUsdLimit
            ? (() => {
                if (amount_denomination === beneficiary.currency_symbol) {
                    return math.multiply(hardCappedMinUsdLimit, usdToFiatConversionRate);
                }
                return (
                    hardCappedMinUsdLimit / (usdToFiatConversionRate / cryptoToFiatConversionRate)
                );
            })()
            : minLimit;

        const amountLessThanLimit =
            amount_denomination === beneficiary.currency_symbol
                ? tradingAmountInFiat < minLimitToUse
                : tradingAmountInToken < minLimitToUse;
        const amountGreaterThanLimit =
            amount_denomination === beneficiary.currency_symbol
                ? maxLimit > ZERO && tradingAmountInFiat > maxLimit
                : maxLimit > ZERO && tradingAmountInToken > maxLimit;

        if (amountLessThanLimit) {
            errorMessages.amount =
                amount_denomination === beneficiary.currency_symbol
                    ? `Amount must be at least ${formatNumberAsCurrency(fixNumber(minLimitToUse, TWO), beneficiary.currency_symbol)}`
                    : `Amount must be at least ${prettifyNumber(minLimitToUse, TWO)} ${assetName}`;
        }
        if (amountGreaterThanLimit) {
            errorMessages.amount =
                amount_denomination === beneficiary.currency_symbol
                    ? `Amount must not exceed ${formatNumberAsCurrency(fixNumber(maxLimit, TWO), beneficiary.currency_symbol)}`
                    : `Amount must not exceed ${prettifyNumber(maxLimit, TWO)} ${assetName}`;
        }

        if (Object.keys(errorMessages).length > 0) {
            const userBalanceFormatted = prettifyNumber(userBalance, FOUR) + ' ' + assetName;
            const userBalanceInFiat = formatNumberAsCurrency(
                fixNumber(userBalance * cryptoToFiatConversionRate, THREE),
                beneficiary.currency_symbol
            );

            const userBalanceMessage = `Your balance:\n${userBalanceFormatted} (${userBalanceInFiat})`;

            const assetLabel = `${assetName} (${assetNetwork})`;
            const sellMessage = `Sell ${assetLabel} for ${getCountryFlagEmoji(beneficiary.country_code)} ${beneficiary.currency_symbol}`;

            return {
                screen: AgentOfframpFlowScreens.AMOUNT_INPUT,
                data: {
                    dynamic_page_title: sellMessage,
                    asset_label: assetLabel,
                    asset_id: asset.listItemId,
                    user_id,
                    beneficiary: beneficiary,
                    amount_denomination_label: 'Provide amount in',
                    amount_denominations: [
                        {
                            id: assetName,
                            title: assetName,
                        },
                        {
                            id: beneficiary.currency_symbol,
                            title: beneficiary.currency_symbol,
                        },
                    ],
                    user_balance: userBalanceMessage,
                    conversion_rate,
                    fee: feeString,
                    init_values: {
                        amount_denomination,
                    },
                    error_messages: errorMessages,
                } satisfies ScreenDataPayload['AMOUNT_INPUT']
            };
        }

        const feeConfig = FiatRampService.calculateTransactionFeeUsd({
            usdAmount: tradingAmountInUsd,
            conditionalFeePercentageConfigs: quotes.conditionalFeePercentConfigs,
            minFeeUsd: quotes.minFeeUsd,
            defaultFeePercentage: quotes.rawFeePercentage,
            rampType: 'offramp',
        });

        const feeInCrypto = feeConfig.feeUsd * cryptoToUsdConversionRate;
        const transactionFeeInUsd = feeConfig.feeUsd;
        const transactionFeeInCrypto = fixNumber(feeInCrypto, THREE);
        const feePercentage = feeConfig.feePercentage;

        const token_amount: TokenAmountPattern = this.generateTokenAmountPattern(
            prettifyNumber(tradingAmountInToken, THREE),
            {
                assetName,
                assetNetwork,
            },
            transactionFeeInCrypto
        );

        const amountToDebit =
            amount_denomination === beneficiary.currency_symbol
                ? fixNumber(math.add(tradingAmountInToken, transactionFeeInCrypto), FOUR)
                : fixNumber(tradingAmountInToken, FOUR);
        const token_amount_to_debit: TokenAmountToDebitPattern = `${amountToDebit} ${assetName}`;

        const destination_account = this.generateDestinationString(beneficiary);

        const tradingAmountInTokenToConvert =
            amount_denomination === beneficiary.currency_symbol
                ? tradingAmountInToken
                : math.subtract(tradingAmountInToken, transactionFeeInCrypto);
        const fiatEquivalent = defaultAmountFixer(
            math.multiply(tradingAmountInTokenToConvert, cryptoToFiatConversionRate)
        );

        const fiat_to_receive: FiatToReceivePattern = this.generateFiatToReceivePattern(
            cryptoToFiatConversionRate,
            beneficiary.currency_symbol,
            assetName,
            fiatEquivalent
        );

        return {
            screen: AgentOfframpFlowScreens.TRANSACTION_SUMMARY,
            data: {
                asset_id,
                user_id,
                display_data: {
                    token_amount,
                    token_amount_to_debit,
                    destination_account,
                    fiat_to_receive,
                },
                transaction_details: {
                    token_amount: decimalToString(fixNumber(tradingAmountInTokenToConvert, FOUR)),
                    transaction_fee: transactionFeeInCrypto.toString(),
                    transaction_fee_usd: transactionFeeInUsd,
                    fiat_to_receive: fiatEquivalent.toString(),
                    beneficiary: beneficiary,
                    token_amount_to_debit: amountToDebit.toString(),
                    conversion_rate,
                    usd_amount: tradingAmountInUsd,
                    platform_fee_percentage: feePercentage.toString(),
                },
                fiat_currency: beneficiary.currency_symbol,
            },
        };
    }

    private static async getFeedbackScreenData(
        input: DataExchangePayload['TRANSACTION_SUMMARY'],
        flowToken : string
    ) {
        const {
            asset_id,
            token_amount,
            token_amount_to_debit,
            fiat_to_receive,
            beneficiary,
            user_id,
            fiat_currency,
            platform_fee_percentage,
            conversion_rate,
            transaction_pin,
            transaction_fee,
        } = input;

        const user = await userServiceV2.getUserById(user_id);
        const assetConfig = getAssetConfigOrThrow(asset_id);

        const [
            usdToFiatConversionRate,
            tradingAmountInToken,
            tradingAmountToDebitInToken,
            transactionFeeInCrypto,
        ] = [
                parseFloat(conversion_rate),
                parseFloat(token_amount.trim()),
                parseFloat(token_amount_to_debit),
                parseFloat(transaction_fee),
            ];
        const cryptoToFiatConversionRate = await getTokenToCurrencyConversionRate(
            assetConfig.tokenName,
            beneficiary.currency_symbol,
            usdToFiatConversionRate
        );
        const cryptoToUsdConversionRate = usdToFiatConversionRate / cryptoToFiatConversionRate;
        const tradingAmountInUsd = tradingAmountInToken / cryptoToUsdConversionRate;
        const feeInUsd = transactionFeeInCrypto / cryptoToUsdConversionRate;

        if (!user?.transactionPinHash) {
            return {
                screen: AgentOfframpFlowScreens.ERROR_FEEDBACK,
                data: {
                    status: 'Failed',
                    title: 'Transaction PIN Not Set',
                    message: 'You have not set a transaction PIN yet. Please set your PIN to continue.',
                    icon_src: ERROR_FEEDBACK_ICON,
                },
            };
        }

        const pinIsValid = await compareHashedString(transaction_pin, user.transactionPinHash);

        if (!pinIsValid) {
            const fiatEquivalent = parseFloat(fiat_to_receive);

            const token_amount_to_debit_display: TokenAmountToDebitPattern = `${tradingAmountInToken} ${assetConfig.tokenName as TokenNames}`;
            const fiat_to_receive_display: FiatToReceivePattern = this.generateFiatToReceivePattern(
                parseFloat(conversion_rate),
                beneficiary.currency_symbol,
                assetConfig.tokenName as TokenNames,
                fiatEquivalent
            );
            const token_amount_display: TokenAmountPattern = this.generateTokenAmountPattern(
                prettifyNumber(tradingAmountInToken, THREE),
                {
                    assetName: assetConfig.tokenName as TokenNames,
                    assetNetwork: assetConfig.network,
                },
                transactionFeeInCrypto
            );

            return {
                screen: AgentOfframpFlowScreens.TRANSACTION_SUMMARY,
                data: {
                    asset_id,
                    user_id,
                    display_data: {
                        token_amount: token_amount_display,
                        token_amount_to_debit: token_amount_to_debit_display,
                        destination_account: this.generateDestinationString(beneficiary),
                        fiat_to_receive: fiat_to_receive_display,
                    },
                    transaction_details: {
                        token_amount: decimalToString(fixNumber(tradingAmountInToken, FOUR)),
                        transaction_fee: transactionFeeInCrypto.toString(),
                        fiat_to_receive: fiatEquivalent.toString(),
                        beneficiary: beneficiary,
                        token_amount_to_debit: tradingAmountToDebitInToken.toString(),
                        conversion_rate,
                        usd_amount: tradingAmountInUsd,
                        platform_fee_percentage: platform_fee_percentage,
                    },
                    fiat_currency: beneficiary.currency_symbol,
                    init_values: {
                        transaction_pin,
                    },
                    error_messages: {
                        transaction_pin: 'Incorrect transaction pin',
                    },
                },
            };
        }

        const supportedCountries = await FiatRampService.getSupportedCurrencies();

        const country = supportedCountries.find((country) => country.code === beneficiary.country_code);

        if (!country) {
            throw new Error('Invalid country code');
        }

        const [firstName, ...rest] = beneficiary.account_name.trim().split(' ');
        const lastName = rest.join(' ')

        const beneficiaryData: BankBeneficiaryType | PhoneBeneficiaryType = (beneficiary.account_type === 'bank')
            ? {
                accountName: beneficiary.account_name.trim(),
                accountNumber: beneficiary.account_number.trim(),
                bankName: beneficiary.provider_name,
                networkId: beneficiary.network_id!,
                channelId: beneficiary.channel_id!,
                countryId: country.id,
            } : {
                firstName: firstName,
                lastName: lastName,
                networkId: beneficiary.network_id!,
                channelId: beneficiary.channel_id!,
                mobileProvider: beneficiary.provider_name,
                mobileNumber: beneficiary.account_number.trim(),
                countryId: country.id
            };

        const beneficiaryId = await FiatRampService.createBeneficiary(
            user.primaryWhatsappPhoneNumber,
            beneficiary.country_code as CountryCode,
            beneficiary.account_type,
            {
                beneficiary: beneficiaryData
            }
        );

        const response = await this.processAgentOffRampTransaction(
            `ngn_vas_payment-${flowToken}`,
            {
                assetId: asset_id,
                fiatAmount: parseFloat(fiat_to_receive),
                usdAmount: tradingAmountInUsd,
                tokenAmountToDebit: tradingAmountToDebitInToken,
                beneficiaryId: beneficiaryId,
                userId: user_id,
                platformFeePercentage: parseFloat(platform_fee_percentage),
                conversionRate: parseFloat(conversion_rate),
                transactionPin: transaction_pin,
                transactionFeeUsd: feeInUsd,
            });

        if (response.status === 'processing') {
            const message = generateOfframpProcessingMessage({
                tokenAmount: prettifyNumber(Number(tradingAmountToDebitInToken), 3),
                assetName: assetConfig.tokenName,
                assetNetwork: assetConfig.network,
                localCurrency: fiat_currency,
                fiatAmount: fiat_to_receive,
            });

            void WhatsAppBotService.sendArbitraryTextMessage(
                user.primaryWhatsappPhoneNumber,
                message
            );
        }

        return {
            screen:
                response.status === 'processing'
                    ? AgentOfframpFlowScreens.PROCESSING_FEEDBACK
                    : AgentOfframpFlowScreens.ERROR_FEEDBACK,
            data: {
                status: response.status[0].toUpperCase() + response.status.slice(1),
                message: response.message,
                icon_src:
                    response.status === 'processing' ? SUCCESS_FEEDBACK_ICON : ERROR_FEEDBACK_ICON,
            },
        };
    }

    public static async processAgentOffRampTransaction(
        jobId: string,
        params: ProcessOfframpTransactionParams
    ): Promise<ProcessOffRampTransactionResponse> {
        const {
            fiatAmount,
            userId,
            assetId,
            tokenAmountToDebit,
            beneficiaryId,
            platformFeePercentage,
            conversionRate,
            transactionPin,
            transactionFeeUsd,
            usdAmount
        } = params;

        const assetConfig = getAssetConfigOrThrow(assetId);

        const [assetBalanceInfo, assetWallet, user] = await Promise.all([
            azzaWalletManager.getAssetBalance({
                userId,
                assetId,
            }),
            azzaWalletManager.getUserWallet(userId, assetConfig.network),
            userServiceV2.getUserById(userId),
        ]);

        if (!user) {
            throw new Error('User not found');
        }

        const assetBalance = assetBalanceInfo.balance;

        if (assetBalance < tokenAmountToDebit) {
            const insufficientBalanceMessage = `You're trying to pay: ${tokenAmountToDebit} ${assetConfig.tokenName}\nYou have only: ${assetBalance} ${assetConfig.tokenName}`;

            return {
                status: 'failed',
                message: insufficientBalanceMessage,
            };
        }

        try {
            const hotWalletAddress = await FiatRampService.getHotWalletForNetwork(
                assetBalanceInfo.blockchainNetwork
            );

            // Process in background and return early processing response
            await queues.eventDrivenOfframp.add(
                'initiate offramp request',
                {
                    offrampParams: {
                        beneficiaryId,
                        usdAmount: usdAmount,
                        localAmount: fiatAmount,
                        userWalletAddress: assetWallet.address,
                        hotWalletAddress,
                        userId: convertAsciiStringToBase64(userId),
                        platformFeePercentage,
                        conversionRate,
                        transactionFeeUsd,
                        assetId,
                        tokenAmountToDebit: tokenAmountToDebit,
                        isAgentTransaction : true
                    },
                    transactionPin: encryptWithAES(
                        transactionPin,
                        env.SECURITY_QUESTIONS_MASK_KEY,
                        env.SECURITY_QUESTIONS_MASK_IV
                    ),
                    whatsappParams: {
                        userPhoneNumber: user.primaryWhatsappPhoneNumber,
                        businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                    },
                },
                {
                    ...defaultQueueRemoveOptions,
                    jobId
                }
            );

            return {
                status: 'processing',
                message:
                    "Your transaction is currently being processed, we'd send updates on the status of your transaction in your DM",
            };
        } catch (error) {
            await logServiceError(error, 'Processing offramp transaction failed');

            return {
                status: 'failed',
                message: 'Transaction failed',
            };
        }
    }

    private static generateTokenAmountPattern(
        amount: string,
        asset: {
            assetName: TokenNames;
            assetNetwork: AllSupportedBlockchains;
        },
        transactionFee: number
    ) {
        const tokenAmount: TokenAmountPattern = `${amount} ${asset.assetName} (${asset.assetNetwork})${SECTION_SEPARATOR}Fee = ${prettifyNumber(transactionFee, 6)} ${asset.assetName}`;

        return tokenAmount;
    }

    private static generateFiatToReceivePattern(
        rate: number,
        currency: string,
        assetName: TokenNames,
        fiatAmount: number
    ) {
        return `${formatNumberAsCurrency(fiatAmount, currency)}${SECTION_SEPARATOR}1 ${assetName} = ${formatNumberAsCurrency(rate, currency)}` satisfies FiatToReceivePattern;
    }

    private static generateDestinationString(
        beneficiary: ScreenDataPayload['AMOUNT_INPUT']['beneficiary']
    ) {
        const { account_name, account_number, provider_name } = beneficiary;

        return `${account_number} | ${account_name} | ${provider_name}` satisfies DestinationPattern;
    }

}


export default WhatsAppBotAgentOffRampFlowService;
