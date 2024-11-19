import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { TokenNames } from '@/resources/web3/tokens';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import {
    BankBeneficiary,
    MobileMoneyBeneficiary,
    SendOfframpRequestPayload,
} from '@/app/FiatRamp/fiatRampSchema';
import {
    decimalToString,
    defaultAmountFixer,
    fixNumber,
    formatNumberAsCurrency,
    getCountryFlagEmoji,
    prettifyNumber,
} from '@/resources/utils/currency';
import UserService from '@/app/User/UserService';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import { logSync } from '@/resources/logger';
import { ProcessOfframpInBackgroundParams } from '@/app/WhatsAppBot/WhatsAppFlows/backgroundProcesses/processOfframp';
import { spawn } from 'child_process';
import path from 'path';
import { generateRandomHexString } from '@/resources/utils/encryption';
import { SIXTEEN, THREE, TWO } from '@/constants/numbers';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import { DropdownOption, type FlowMode } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import { UserAssetInfo } from '@/app/User/userSchema';
import { generateOfframpProcessingMessage } from '@/resources/utils/bot-message-utils';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { getFlowConfig } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import env from '@/constants/env';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { CountryCode } from 'libphonenumber-js';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';

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
    beneficiary_id: string;
    transaction_fee: string;
    fiat_currency: string;
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
    `${number} ${TokenNames} (${SupportedChain | ExtendedWalletSupportedNetworks})\n---------------------------------\nFee = ${number} ${TokenNames}`;
type TokenAmountToDebitPattern = `${number} ${TokenNames}`;
type DestinationPattern = `${string} | ${string} | ${string}`;
type FiatToReceivePattern =
    `${string}\n---------------------------------\n1 ${TokenNames} = ${string}`;

const SECTION_SEPARATOR = '\n---------------------------------\n' as const;

type ProcessOffRampTransactionResponse = {
    status: 'processing' | 'complete' | 'failed' | 'pending';
    message: string;
};

const BACKGROUND_PROCESSES_SCRIPTS_FOLDER = path.join(__dirname, 'backgroundProcesses');

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

            logSync('debug', 'Next screen data', nextScreenData);

            return {
                ...nextScreenData,
                version: requestBody.version,
            };
        }

        throw new Error('Unhandled action');
    }

    private static generateTokenAmountPattern(
        amount: number,
        asset: UserAssetInfo,
        transactionFee: number
    ) {
        const tokenAmount: TokenAmountPattern = `${amount} ${asset.assetName} (${asset.assetNetwork})${SECTION_SEPARATOR}Fee = ${transactionFee} ${asset.assetName}`;

        return tokenAmount;
    }

    private static generateFiatToReceivePattern(
        rate: number,
        currency: string,
        asset: UserAssetInfo,
        fiatAmount: number
    ) {
        return `${formatNumberAsCurrency(fiatAmount, currency)}${SECTION_SEPARATOR}1 ${asset.assetName} = ${formatNumberAsCurrency(rate, currency)}` satisfies FiatToReceivePattern;
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
            fee: feeString,
        } = input;
        const [{ countryFiatLimits: countryLimits }, assetWallet] = await Promise.all([
            FiatRampService.getPaymentMethods(beneficiary.country_code as CountryCode, 'offramp'),
            UserService.getUserAssetInfo(user_id, asset_id),
        ]);

        const [conversionRate, fee, amountAsNumber] = [
            parseFloat(conversion_rate),
            parseFloat(feeString),
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
        const { assetName, assetNetwork, tokenBalance: userBalance } = assetWallet;

        const errorMessages: AmountInputScreenData['error_messages'] = {};

        const amountLessThanLimit =
            amount_denomination === beneficiary.currency_symbol
                ? amountAsNumber < minLimit
                : usdAmount < minLimit;
        const amountGreaterThanLimit =
            amount_denomination === beneficiary.currency_symbol
                ? amountAsNumber > maxLimit
                : usdAmount > maxLimit;

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
                    asset_id: assetWallet.listItemId,
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

        const transactionFee = fixNumber(usdAmount * fee, THREE);

        const token_amount: TokenAmountPattern = this.generateTokenAmountPattern(
            fixNumber(usdAmount, THREE),
            assetWallet,
            transactionFee
        );
        const amountToDebit = defaultAmountFixer(usdAmount + transactionFee);

        const token_amount_to_debit: TokenAmountToDebitPattern = `${amountToDebit} ${assetName}`;

        const destination_account = this.generateDestinationString(beneficiary);

        const fiatEquivalent = defaultAmountFixer(usdAmount * conversionRate);

        const fiat_to_receive: FiatToReceivePattern = this.generateFiatToReceivePattern(
            conversionRate,
            beneficiary.currency_symbol,
            assetWallet,
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
                    beneficiary_id: beneficiary.id,
                    token_amount_to_debit: amountToDebit.toString(),
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
            beneficiary_id,
            user_id,
            fiat_currency,
        } = input;
        const response = await this.processOffRampTransaction({
            assetId: asset_id,
            fiatAmount: parseFloat(fiat_to_receive),
            tokenAmount: parseFloat(token_amount),
            tokenAmountToDebit: parseFloat(token_amount_to_debit),
            beneficiaryId: beneficiary_id,
            userId: user_id,
        });

        if (response.status === 'processing') {
            const assetConfig = getAssetConfigOrThrow(asset_id);

            const message = generateOfframpProcessingMessage({
                tokenAmount: token_amount,
                assetName: assetConfig.tokenName,
                assetNetwork: assetConfig.network,
                localCurrency: fiat_currency,
                fiatAmount: fiat_to_receive,
            });

            WhatsAppBotService.sendArbitraryTextMessage(user_id, message).then(() =>
                console.log('Message sent')
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
    }): Promise<ProcessOffRampTransactionResponse> {
        const { fiatAmount, userId, assetId, tokenAmountToDebit, beneficiaryId, tokenAmount } =
            params;

        const assetConfig = getAssetConfigOrThrow(assetId);
        const walletInfo = await UserService.getUserAssetInfo(userId, assetId);
        const assetBalance = walletInfo.tokenBalance;

        if (assetBalance < tokenAmountToDebit) {
            const insufficientBalanceMessage = `You're trying to pay: ${tokenAmountToDebit} ${assetConfig.tokenName}\nYou have only: ${assetBalance} ${assetConfig.tokenName}`;

            return {
                status: 'failed',
                message: insufficientBalanceMessage,
            };
        }

        try {
            const { transactionId, hotWalletAddress } = await UserService.sendUserAssetForOfframp(
                walletInfo,
                tokenAmountToDebit.toString()
            );

            // Process in background and return early processing response
            this.processOfframpInBackground(
                transactionId,
                {
                    beneficiaryId,
                    usdAmount: tokenAmount,
                    localAmount: fiatAmount,
                    tokenAddress: assetConfig.tokenAddress,
                    chainName: assetConfig.network,
                    tokenName: assetConfig.tokenName,
                    userWalletAddress: walletInfo.walletAddress,
                    hotWalletAddress,
                },
                assetConfig.network,
                userId
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

    public static processOfframpInBackground(
        onChainTransactionId: string,
        offrampParams: Omit<SendOfframpRequestPayload, 'txHash'>,
        network: SupportedChain | ExtendedWalletSupportedNetworks,
        userId: string
    ) {
        const serializedParams = JSON.stringify({
            ...offrampParams,
            onChainTransactionId,
            network,
            userId,
        } satisfies ProcessOfframpInBackgroundParams);

        // Spawn the background process
        const backgroundProcess = spawn(
            'tsx',
            [path.join(BACKGROUND_PROCESSES_SCRIPTS_FOLDER, 'processOfframp.ts'), serializedParams],
            {
                stdio: 'inherit', // Optional: Inherit stdio to see logs in the parent process console
            }
        );

        backgroundProcess.on('error', (err) => {
            logSync('error', 'Failed to start background process:', err);
        });
    }

    public static generateOffRampFlowInitMessage(params: {
        asset: UserAssetInfo;
        beneficiary: BankBeneficiary | MobileMoneyBeneficiary;
        recipient: string;
        fiatConversionRate: number;
        transactionFee: number;
    }) {
        const { asset, beneficiary, recipient } = params;

        const assetLabel = `${asset.assetName} (${asset.assetNetwork})`;

        const beneficiaryName =
            'bankName' in beneficiary
                ? beneficiary.accountName
                : beneficiary.firstName + ' ' + beneficiary.lastName;
        const beneficiaryAccountNumber =
            'bankName' in beneficiary ? beneficiary.accountNumber : beneficiary.mobileNumber;
        const beneficiaryProvider =
            'bankName' in beneficiary ? beneficiary.bankName : beneficiary.mobileProvider;

        const sellMessage = `Sell ${assetLabel} for ${getCountryFlagEmoji(beneficiary.country.code)} ${beneficiary.country.currencySymbol}`;

        const userBalance = asset.tokenBalance;
        const userBalanceFormatted = prettifyNumber(userBalance) + ' ' + asset.assetName;
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
                        flow_cta: 'Sell Asset',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: this.INITIAL_SCREEN,
                            data: {
                                dynamic_page_title: sellMessage,
                                asset_label: assetLabel,
                                asset_id: asset.listItemId,
                                user_id: recipient,
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
                                        id: asset.assetName,
                                        title: asset.assetName,
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
                                    amount_denomination: asset.assetName,
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
