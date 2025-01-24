import { AssetTransferRecipientType } from '@/app/azza/azza.schema';
import { AssetBalance } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { BankBeneficiary, MobileMoneyBeneficiary } from '@/app/FiatRamp/fiatRampSchema';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { getFlowConfig } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import { DropdownOption, type FlowMode } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import { offrampFlowProducer } from '@/background-processing/flow-producers';
import { defaultQueueRemoveOptions } from '@/background-processing/queues';
import { OfframpQueueFlowParams } from '@/background-processing/schema';
import { CryptoDebitQueueInput, QueueNames } from '@/background-processing/types';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import env from '@/constants/env';
import { ERROR_FEEDBACK_ICON, SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { SIXTEEN, THREE, TWO, ZERO } from '@/constants/numbers';
import { UserV2Record } from '@/db/xata';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import { generateOfframpProcessingMessage } from '@/resources/utils/bot-message-utils';
import {
    decimalToString,
    defaultAmountFixer,
    fixNumber,
    formatNumberAsCurrency,
    getCountryFlagEmoji,
    prettifyNumber,
} from '@/resources/utils/currency';
import {
    convertAsciiStringToBase64,
    encryptWithAES,
    generateRandomHexString,
} from '@/resources/utils/encryption';
import { compareHashedString } from '@/resources/utils/hashing';
import { TokenNames } from '@/resources/web3/tokens';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { CountryCode } from 'libphonenumber-js';
import * as math from 'mathjs';

enum OffRampFlowScreens {
    AMOUNT_INPUT = 'AMOUNT_INPUT',
    TRANSACTION_SUMMARY = 'TRANSACTION_SUMMARY',
    PROCESSING_FEEDBACK = 'PROCESSING_FEEDBACK',
    ERROR_FEEDBACK = 'ERROR_FEEDBACK',
}

type DataExchangedFromAmountInputScreen = {
    amount: string;
    asset_id: string;
    user_id: string;
    beneficiary: {
        id: string;
        account_name: string;
        account_number: string;
        provider_name: string;
        currency_symbol: string;
        country_code: string;
    };
    amount_denomination: string;
    asset_label: string;
    conversion_rate: string;
    fee: string;
};
type DataExchangedFromTransactionSummaryScreen = {
    asset_id: string;
    token_amount_to_debit: string;
    token_amount: string;
    user_id: string;
    fiat_to_receive: string;
    transaction_fee: string;
    conversion_rate: string;
    platform_fee_percentage: string;
    fiat_currency: string;
    transaction_pin: string;
    beneficiary: {
        id: string;
        account_name: string;
        account_number: string;
        provider_name: string;
        currency_symbol: string;
        country_code: string;
    };
};

type AmountInputScreenData = {
    dynamic_page_title: string;
    asset_label: string;
    asset_id: string;
    user_id: string;
    beneficiary: DataExchangedFromAmountInputScreen['beneficiary'];
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
};

type TokenAmountPattern =
    `${string} ${TokenNames} (${SupportedChain | ExtendedWalletSupportedNetworks})\n---------------------------------\nFee = ${number} ${TokenNames}`;
type TokenAmountToDebitPattern = `${number} ${TokenNames}`;
type DestinationPattern = `${string} | ${string} | ${string}`;
type FiatToReceivePattern =
    `${string}\n---------------------------------\n1 ${TokenNames} = ${string}`;

const SECTION_SEPARATOR = '\n---------------------------------\n' as const;

type ProcessOffRampTransactionResponse = {
    status: 'processing' | 'complete' | 'failed' | 'pending';
    message: string;
};

const flowConfig = getFlowConfig('OFFRAMP', env.WA_PHONE_NUMBER_ID);

class WhatsAppBotOffRampFlowService {
    private static FLOW_MODE: FlowMode = flowConfig.flowMode;
    private static FLOW_ID = flowConfig.flowId;
    private static INITIAL_SCREEN = OffRampFlowScreens.AMOUNT_INPUT;

    public static async receiveDataExchange(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ): Promise<DataExchangeResponse> {
        const { action, screen, data } = requestBody;

        if (action === 'INIT') {
            // Using Preview data because initialization should typically be done from `WhatsAppBotService.beginOffRampFlowMessage`
            return this.previewInitializationFlow(requestBody);
        }

        if (action === 'data_exchange') {
            let nextScreenData: Omit<DataExchangeResponse, 'version'> | undefined;

            switch (screen) {
                case OffRampFlowScreens.AMOUNT_INPUT:
                    nextScreenData = await this.getTransactionSummaryScreenData(
                        data as DataExchangedFromAmountInputScreen
                    );
                    break;

                case OffRampFlowScreens.TRANSACTION_SUMMARY:
                    nextScreenData = await this.getFeedbackScreenData(
                        data as DataExchangedFromTransactionSummaryScreen
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

    private static generateTokenAmountPattern(
        amount: string,
        asset: {
            assetName: TokenNames;
            assetNetwork: SupportedChain | ExtendedWalletSupportedNetworks;
        },
        transactionFee: number
    ) {
        const tokenAmount: TokenAmountPattern = `${amount} ${asset.assetName} (${asset.assetNetwork})${SECTION_SEPARATOR}Fee = ${transactionFee} ${asset.assetName}`;

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
        beneficiary: DataExchangedFromAmountInputScreen['beneficiary']
    ) {
        const { account_name, account_number, provider_name } = beneficiary;

        return `${account_number} | ${account_name} | ${provider_name}` satisfies DestinationPattern;
    }

    private static async getTransactionSummaryScreenData(
        input: DataExchangedFromAmountInputScreen
    ) {
        const {
            amount,
            asset_id,
            beneficiary,
            user_id,
            amount_denomination,
            conversion_rate,
            fee: feeString, // Todo: Consider removing fee from screen data exchange payload
        } = input;
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

        const [conversionRate, amountAsNumber] = [
            parseFloat(conversion_rate),
            parseFloat(amount.trim()),
        ];

        const usdAmount =
            amount_denomination === beneficiary.currency_symbol
                ? amountAsNumber / conversionRate
                : amountAsNumber;

        const [minLimit, maxLimit] = [
            amount_denomination === beneficiary.currency_symbol
                ? countryLimits.min
                : countryLimits.min / conversionRate,
            amount_denomination === beneficiary.currency_symbol
                ? countryLimits.max
                : countryLimits.max / conversionRate,
        ];

        // Asset Config
        const { asset, blockchainNetwork: assetNetwork, balance: userBalance } = assetBalance;
        const assetName = asset.tokenName as TokenNames;

        const errorMessages: AmountInputScreenData['error_messages'] = {};

        if (usdAmount <= 0) {
            errorMessages.amount = 'Amount must be greater than 0';
        }

        const amountLessThanLimit =
            amount_denomination === beneficiary.currency_symbol
                ? amountAsNumber < minLimit
                : usdAmount < minLimit;
        const amountGreaterThanLimit =
            amount_denomination === beneficiary.currency_symbol
                ? maxLimit > ZERO && amountAsNumber > maxLimit
                : maxLimit > ZERO && usdAmount > maxLimit;

        if (amountLessThanLimit) {
            errorMessages.amount =
                amount_denomination === beneficiary.currency_symbol
                    ? `Amount must be at least ${formatNumberAsCurrency(fixNumber(minLimit, TWO), beneficiary.currency_symbol)}`
                    : `Amount must be at least ${prettifyNumber(minLimit, TWO)} ${assetName}`;
        }
        if (amountGreaterThanLimit) {
            errorMessages.amount =
                amount_denomination === beneficiary.currency_symbol
                    ? `Amount must not exceed ${formatNumberAsCurrency(fixNumber(maxLimit, TWO), beneficiary.currency_symbol)}`
                    : `Amount must not exceed ${prettifyNumber(maxLimit, TWO)} ${assetName}`;
        }

        if (Object.keys(errorMessages).length > 0) {
            const userBalanceFormatted = prettifyNumber(userBalance) + ' ' + assetName;
            const userBalanceInFiat = formatNumberAsCurrency(
                fixNumber(userBalance * conversionRate, THREE),
                beneficiary.currency_symbol
            );

            const userBalanceMessage = `Your balance:\n${userBalanceFormatted} (${userBalanceInFiat})`;

            const assetLabel = `${assetName} (${assetNetwork})`;
            const sellMessage = `Sell ${assetLabel} for ${getCountryFlagEmoji(beneficiary.country_code)} ${beneficiary.currency_symbol}`;

            return {
                screen: OffRampFlowScreens.AMOUNT_INPUT,
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
                } satisfies AmountInputScreenData,
            };
        }

        const feeConfig = FiatRampService.calculateTransactionFeeUsd({
            usdAmount,
            conditionalFeePercentageConfigs: quotes.conditionalFeePercentConfigs,
            minFeeUsd: quotes.minFeeUsd,
            defaultFeePercentage: quotes.rawFeePercentage,
            rampType: 'offramp',
        });

        const transactionFee = fixNumber(feeConfig.feeUsd, THREE);
        const feePercentage = feeConfig.feePercentage;

        const token_amount: TokenAmountPattern = this.generateTokenAmountPattern(
            prettifyNumber(usdAmount, THREE),
            {
                assetName,
                assetNetwork,
            },
            transactionFee
        );

        const amountToDebit = fixNumber(math.add(usdAmount, transactionFee), THREE);
        const token_amount_to_debit: TokenAmountToDebitPattern = `${amountToDebit} ${assetName}`;

        const destination_account = this.generateDestinationString(beneficiary);

        const fiatEquivalent = defaultAmountFixer(math.multiply(usdAmount, conversionRate));

        const fiat_to_receive: FiatToReceivePattern = this.generateFiatToReceivePattern(
            conversionRate,
            beneficiary.currency_symbol,
            assetName,
            fiatEquivalent
        );

        return {
            screen: OffRampFlowScreens.TRANSACTION_SUMMARY,
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
                    token_amount: decimalToString(fixNumber(usdAmount, THREE)),
                    transaction_fee: transactionFee.toString(),
                    fiat_to_receive: fiatEquivalent.toString(),
                    beneficiary: beneficiary,
                    token_amount_to_debit: amountToDebit.toString(),
                    conversion_rate,
                    usd_amount: usdAmount,
                    platform_fee_percentage: feePercentage.toString(),
                },
                fiat_currency: beneficiary.currency_symbol,
            },
        };
    }

    private static async getFeedbackScreenData(input: DataExchangedFromTransactionSummaryScreen) {
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

        if (!user?.transactionPinHash) {
            return {
                screen: OffRampFlowScreens.ERROR_FEEDBACK,
                data: {
                    status: 'Failed',
                    message: 'Transaction pin not set',
                    icon_src: ERROR_FEEDBACK_ICON,
                },
            };
        }

        const pinIsValid = await compareHashedString(transaction_pin, user.transactionPinHash);

        if (!pinIsValid) {
            const usdAmount = parseFloat(token_amount);
            const usdAmountToDebit = parseFloat(token_amount_to_debit);
            const transactionFee = parseFloat(input.transaction_fee);
            const fiatEquivalent = parseFloat(fiat_to_receive);

            const token_amount_to_debit_display: TokenAmountToDebitPattern = `${usdAmountToDebit} ${assetConfig.tokenName as TokenNames}`;
            const fiat_to_receive_display: FiatToReceivePattern = this.generateFiatToReceivePattern(
                parseFloat(conversion_rate),
                beneficiary.currency_symbol,
                assetConfig.tokenName as TokenNames,
                fiatEquivalent
            );
            const token_amount_display: TokenAmountPattern = this.generateTokenAmountPattern(
                prettifyNumber(usdAmount, THREE),
                {
                    assetName: assetConfig.tokenName as TokenNames,
                    assetNetwork: assetConfig.network,
                },
                transactionFee
            );

            return {
                screen: OffRampFlowScreens.TRANSACTION_SUMMARY,
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
                        token_amount: decimalToString(fixNumber(usdAmount, THREE)),
                        transaction_fee: transactionFee.toString(),
                        fiat_to_receive: fiatEquivalent.toString(),
                        beneficiary: beneficiary,
                        token_amount_to_debit: usdAmountToDebit.toString(),
                        conversion_rate,
                        usd_amount: token_amount_to_debit,
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

        const response = await this.processOffRampTransaction({
            assetId: asset_id,
            fiatAmount: parseFloat(fiat_to_receive),
            tokenAmount: parseFloat(token_amount),
            tokenAmountToDebit: parseFloat(token_amount_to_debit),
            beneficiaryId: beneficiary.id,
            userId: user_id,
            platformFeePercentage: parseFloat(platform_fee_percentage),
            conversionRate: parseFloat(conversion_rate),
            transactionPin: transaction_pin,
            transactionFeeUsd: parseFloat(transaction_fee),
        });

        if (response.status === 'processing') {
            const message = generateOfframpProcessingMessage({
                tokenAmount: prettifyNumber(Number(token_amount_to_debit), 3),
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
                    ? OffRampFlowScreens.PROCESSING_FEEDBACK
                    : OffRampFlowScreens.ERROR_FEEDBACK,
            data: {
                status: response.status[0].toUpperCase() + response.status.slice(1),
                message: response.message,
                icon_src:
                    response.status === 'processing' ? SUCCESS_FEEDBACK_ICON : ERROR_FEEDBACK_ICON,
            },
        };
    }

    private static async processOffRampTransaction(params: {
        fiatAmount: number;
        userId: string;
        assetId: string;
        tokenAmount: number;
        tokenAmountToDebit: number;
        beneficiaryId: string;
        platformFeePercentage: number;
        conversionRate: number;
        transactionPin: string;
        transactionFeeUsd: number;
    }): Promise<ProcessOffRampTransactionResponse> {
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
            tokenAmount,
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
            await offrampFlowProducer.add(
                {
                    name: 'process-fiat-payout',
                    queueName: QueueNames.fiatPayout,
                    data: {
                        beneficiaryId,
                        usdAmount: tokenAmount,
                        localAmount: fiatAmount,
                        tokenAddress: assetConfig.tokenAddress,
                        chainName: assetConfig.network,
                        tokenName: assetConfig.tokenName,
                        userWalletAddress: assetWallet.address,
                        hotWalletAddress,
                        userId: convertAsciiStringToBase64(userId),
                        platformFeePercentage,
                        conversionRate,
                        transactionFeeUsd,
                        whatsappParams: {
                            userPhoneNumber: user.primaryWhatsappPhoneNumber!,
                            businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        },
                    } satisfies OfframpQueueFlowParams,
                    children: [
                        {
                            name: 'offramp-debit-confirmation',
                            queueName: QueueNames.cryptoDebitConfirmation,
                            children: [
                                {
                                    name: 'offramp-debit',
                                    queueName: QueueNames.cryptoDebit,
                                    data: {
                                        transferDetails: {
                                            userId: convertAsciiStringToBase64(userId),
                                            amount: tokenAmountToDebit,
                                            transactionFee: 0, // Fee for onchain transfer
                                            assetId,
                                            recipient: hotWalletAddress,
                                            recipientType:
                                                AssetTransferRecipientType.WALLET_ADDRESS,
                                            transactionType: 'SEND',
                                            transactionPin: encryptWithAES(
                                                transactionPin,
                                                env.SECURITY_QUESTIONS_MASK_KEY,
                                                env.SECURITY_QUESTIONS_MASK_IV
                                            ),
                                        },
                                        whatsappParams: {
                                            userPhoneNumber: user.primaryWhatsappPhoneNumber!,
                                            businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                                        },
                                    } satisfies CryptoDebitQueueInput,
                                },
                            ],
                        },
                    ],
                },
                {
                    queuesOptions: {
                        [QueueNames.cryptoDebitConfirmation]: {
                            defaultJobOptions: {
                                ...defaultQueueRemoveOptions,
                            },
                        },
                        [QueueNames.cryptoDebit]: {
                            defaultJobOptions: {
                                ...defaultQueueRemoveOptions,
                            },
                        },
                        [QueueNames.fiatPayout]: {
                            defaultJobOptions: {
                                ...defaultQueueRemoveOptions,
                            },
                        },
                    },
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

    public static generateOffRampFlowInitMessage(
        user: UserV2Record,
        params: {
            assetBalance: AssetBalance;
            beneficiary: BankBeneficiary | MobileMoneyBeneficiary;
            recipient: string;
            fiatConversionRate: number;
            transactionFee: number; // Todo: Evaluate the necessity of this parameter
        }
    ) {
        const { assetBalance, beneficiary, recipient } = params;

        const { balance: userBalance, asset } = assetBalance;
        const assetLabel = `${asset.tokenName} (${asset.network})`;

        const beneficiaryName =
            'bankName' in beneficiary
                ? beneficiary.accountName
                : beneficiary.firstName + ' ' + beneficiary.lastName;
        const beneficiaryAccountNumber =
            'bankName' in beneficiary ? beneficiary.accountNumber : beneficiary.mobileNumber;
        const beneficiaryProvider =
            'bankName' in beneficiary ? beneficiary.bankName : beneficiary.mobileProvider;

        const sellMessage = `To sell ${assetLabel} for ${getCountryFlagEmoji(beneficiary.country.code)} ${beneficiary.country.currencySymbol}, tap "Proceed" to enter the amount you want to sell`;

        const userBalanceFormatted = prettifyNumber(userBalance) + ' ' + asset.tokenName;
        const userBalanceInFiat = formatNumberAsCurrency(
            fixNumber(userBalance * params.fiatConversionRate, THREE),
            beneficiary.country.currencySymbol
        );

        const userBalanceMessage = `Your balance:\n${userBalanceFormatted} (${userBalanceInFiat})`;

        const flowMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'flow',
                body: {
                    text: sellMessage,
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
                                dynamic_page_title: sellMessage,
                                asset_label: assetLabel,
                                asset_id: asset.listItemId,
                                user_id: user.id,
                                beneficiary: {
                                    account_name: beneficiaryName,
                                    account_number: beneficiaryAccountNumber,
                                    provider_name: beneficiaryProvider,
                                    id: beneficiary.id,
                                    currency_symbol: beneficiary.country.currencySymbol,
                                    country_code: beneficiary.country.code,
                                },
                                amount_denomination_label: 'Provide amount in',
                                amount_denominations: [
                                    {
                                        id: asset.tokenName,
                                        title: asset.tokenName,
                                    },
                                    {
                                        id: beneficiary.country.currencySymbol,
                                        title: beneficiary.country.currencySymbol,
                                    },
                                ],
                                user_balance: userBalanceMessage,
                                conversion_rate: params.fiatConversionRate.toString(),
                                fee: params.transactionFee.toString(),
                                init_values: {
                                    amount_denomination: asset.tokenName,
                                },
                            } satisfies AmountInputScreenData,
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
            dynamic_page_title: 'Sell USDT (Base) for NGN',
            asset_label: 'USDT (Polygon)',
            asset_id: 'usdt-polygon',
            beneficiary: {
                id: 'rec_juyaqajdhdd',
                account_name: 'John Doe',
                account_number: '1234567890',
                provider_name: 'GTBank',
            },
        };

        return {
            screen: OffRampFlowScreens.AMOUNT_INPUT,
            data,
            version: requestBody.version,
        };
    }
}

export default WhatsAppBotOffRampFlowService;
