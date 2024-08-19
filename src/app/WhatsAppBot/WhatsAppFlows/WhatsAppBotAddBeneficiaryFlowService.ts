import { AssetConfig } from '@/Resources/web3/tokens';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { DropdownOption, FlowMode } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import logger from '@/Resources/logger';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { CountryCode } from 'libphonenumber-js';
import { parseUnknownError } from '@/Resources/requestHelpers/handleRequestError';
import { generateRandomHexString } from '@/Resources/utils/encryption';
import { SIXTEEN } from '@/constants/numbers';
import { getFlowConfig } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import env from '@/constants/env';

enum AddBeneficiaryFlowScreens {
    ACCOUNT_TYPE = 'ACCOUNT_TYPE',
    BANK_ACCOUNT_FORM = 'BANK_ACCOUNT_FORM',
    MOBILE_MONEY_FORM = 'MOBILE_MONEY_FORM',
    SUCCESS_FEEDBACK = 'SUCCESS_FEEDBACK',
    ERROR_FEEDBACK = 'ERROR_FEEDBACK',
}

type ScreenDataPayload = {
    ACCOUNT_TYPE_SCREEN: {
        account_types: Array<DropdownOption>;
        asset_id: string;
        user_id: string;
        country_code: string;
    };
    BANK_ACCOUNT_FORM_SCREEN: {
        country_code: string;
        channel_id: string;
        asset_id: string;
        user_id: string;
        supported_banks: Array<DropdownOption>;
    };
    MOBILE_MONEY_FORM_SCREEN: {
        supported_mobile_providers: Array<Required<DropdownOption>>;
        country_code: string;
        channel_id: string;
        asset_id: string;
        user_id: string;
    };
    SUCCESS_FEEDBACK_SCREEN: {
        message: string;
        beneficiary_id: string;
        asset_id: string;
    };
    ERROR_FEEDBACK_SCREEN: {
        message: string;
    };
};

type DataExchangePayload = {
    ACCOUNT_TYPE_SCREEN: {
        account_type: string;
        account_types: Array<DropdownOption>;
        asset_id: string;
        user_id: string;
        country_code: string;
    };
    BANK_ACCOUNT_FORM_SCREEN: {
        country_code: string;
        channel_id: string;
        bank: string;
        account_name: string;
        account_number: string;
        asset_id: string;
        user_id: string;
        supported_banks: Array<DropdownOption>;
    };
    MOBILE_MONEY_FORM_SCREEN: {
        supported_mobile_providers: Array<Required<DropdownOption>>;
        country_code: string;
        channel_id: string;
        mobile_provider: string;
        first_name: string;
        last_name: string;
        mobile_number: string;
        asset_id: string;
        user_id: string;
    };
    SUCCESS_FEEDBACK_SCREEN: {
        message: string;
        beneficiary_id: string;
        asset_id: string;
    };
};

const flowConfig = getFlowConfig('ADD_BENEFICIARY', env.WA_PHONE_NUMBER_ID);

class WhatsAppBotAddBeneficiaryFlowService {
    private static FLOW_MODE: FlowMode = flowConfig.flowMode;
    public static readonly FLOW_ID = flowConfig.flowId;
    private static INITIAL_SCREEN = AddBeneficiaryFlowScreens.ACCOUNT_TYPE;

    public static async receiveDataExchange(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ): Promise<DataExchangeResponse> {
        const { screen, data, action } = requestBody;

        logger.info(`Received data exchange for screen: ${screen}`, {
            data,
        });

        if (action === 'data_exchange') {
            let nextScreenData: Omit<DataExchangeResponse, 'version'> | undefined;

            switch (screen) {
                case AddBeneficiaryFlowScreens.ACCOUNT_TYPE:
                    const typedData = data as DataExchangePayload['ACCOUNT_TYPE_SCREEN'];
                    const selectedAccountType = this.determineSelectedAccountType(
                        typedData.account_type,
                        typedData.account_types
                    );

                    if (selectedAccountType.accountType === 'bank') {
                        nextScreenData = await this.getBankAccountFormScreenData(typedData);
                    } else {
                        nextScreenData = await this.getMobileMoneyAccountFormScreenData(typedData);
                    }

                    break;

                case AddBeneficiaryFlowScreens.BANK_ACCOUNT_FORM:
                    nextScreenData = await this.getFeedbackScreenDataForAddingBankBeneficiary(
                        data as DataExchangePayload['BANK_ACCOUNT_FORM_SCREEN']
                    );

                    break;

                case AddBeneficiaryFlowScreens.MOBILE_MONEY_FORM:
                    nextScreenData =
                        await this.getFeedbackScreenDataForAddingMobileMoneyBeneficiary(
                            data as DataExchangePayload['MOBILE_MONEY_FORM_SCREEN']
                        );
            }

            if (!nextScreenData) {
                throw new Error('Unhandled screen');
            }

            logger.info('Next screen data', nextScreenData);

            return {
                ...nextScreenData,
                version: requestBody.version,
            };
        }

        throw new Error('Unhandled action');
    }

    private static determineSelectedAccountType(
        account_type: string,
        account_types: Array<DropdownOption>
    ) {
        const selectedAccountType = account_types.find((type) => type.id === account_type);

        if (!selectedAccountType) {
            throw new Error('Invalid account type');
        }

        return {
            accountType: selectedAccountType.title.toLowerCase().includes('bank')
                ? 'bank'
                : 'phone',
            channelId: selectedAccountType.id,
        };
    }

    private static determineSelectedBank(bank: string, supported_banks: Array<DropdownOption>) {
        const selectedBank = supported_banks.find((type) => type.id === bank);

        if (!selectedBank) {
            throw new Error('Invalid bank');
        }

        return {
            bankName: selectedBank.title,
            networkId: selectedBank.id,
        };
    }

    private static determineSelectedMobileProvider(
        mobileProvider: string,
        supportedMobileProviders: Array<Required<DropdownOption>>
    ) {
        const selectedMobileProvider = supportedMobileProviders.find(
            (type) => type.id === mobileProvider
        );

        if (!selectedMobileProvider) {
            throw new Error('Invalid account type');
        }

        return {
            providerName: selectedMobileProvider.title,
            networkId: selectedMobileProvider.id,
            providerCode: selectedMobileProvider.description,
        };
    }

    public static generateAddBeneficiaryFlowInitMessage(params: {
        asset: AssetConfig;
        countryCode: string;
        recipient: string;
        accountTypes: Array<DropdownOption>;
        bodyText?: string;
    }) {
        const { asset, countryCode, recipient, accountTypes, bodyText } = params;

        const flowMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'flow',
                body: {
                    text: bodyText ?? 'Click the button below to add a new beneficiary',
                },
                action: {
                    name: 'flow',
                    parameters: {
                        flow_message_version: '3',
                        flow_token: generateRandomHexString(SIXTEEN),
                        flow_id: this.FLOW_ID,
                        mode: this.FLOW_MODE,
                        flow_cta: 'Add Beneficiary',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: this.INITIAL_SCREEN,
                            data: {
                                account_types: accountTypes,
                                asset_id: asset.listItemId,
                                user_id: recipient,
                                country_code: countryCode,
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
        const { account_types, account_type, asset_id, user_id, country_code } = input;

        const selectedAccountType = this.determineSelectedAccountType(account_type, account_types);

        const supportedBanks = await FiatRampService.getSupportedBanks(
            selectedAccountType.channelId
        );

        return {
            screen: AddBeneficiaryFlowScreens.BANK_ACCOUNT_FORM,
            data: {
                supported_banks: supportedBanks.map((bank) => ({
                    title: bank.name,
                    id: bank.networkId,
                })),
                country_code,
                channel_id: selectedAccountType.channelId,
                asset_id,
                user_id,
            } satisfies ScreenDataPayload['BANK_ACCOUNT_FORM_SCREEN'],
        };
    }

    private static async getMobileMoneyAccountFormScreenData(
        input: DataExchangePayload['ACCOUNT_TYPE_SCREEN']
    ) {
        const { account_types, account_type, asset_id, user_id, country_code } = input;

        const selectedAccountType = this.determineSelectedAccountType(account_type, account_types);

        const supportedProviders = await FiatRampService.getSupportedMobileProviders(
            selectedAccountType.channelId
        );

        return {
            screen: AddBeneficiaryFlowScreens.BANK_ACCOUNT_FORM,
            data: {
                supported_mobile_providers: supportedProviders.map((provider) => ({
                    title: provider.name,
                    id: provider.networkId,
                    description: provider.code,
                })),
                country_code,
                channel_id: selectedAccountType.channelId,
                asset_id,
                user_id,
            } satisfies ScreenDataPayload['MOBILE_MONEY_FORM_SCREEN'],
        };
    }

    private static async getFeedbackScreenDataForAddingBankBeneficiary(
        input: DataExchangePayload['BANK_ACCOUNT_FORM_SCREEN']
    ) {
        const {
            country_code,
            channel_id,
            bank,
            account_name,
            account_number,
            asset_id,
            user_id,
            supported_banks,
        } = input;

        const selectedBank = this.determineSelectedBank(bank, supported_banks);

        try {
            const supportedCountries = await FiatRampService.getSupportedCurrencies();
            const country = supportedCountries.find((country) => country.code === country_code);

            if (!country) {
                throw new Error('Invalid country code');
            }

            const beneficiaryId = await FiatRampService.createBeneficiary(
                user_id,
                country_code as CountryCode,
                'bank',
                {
                    beneficiary: {
                        accountName: account_name,
                        accountNumber: account_number,
                        bankName: selectedBank.bankName,
                        networkId: selectedBank.networkId,
                        channelId: channel_id,
                        countryId: country.id,
                    },
                }
            );

            return {
                screen: AddBeneficiaryFlowScreens.SUCCESS_FEEDBACK,
                data: {
                    message: 'Beneficiary added successfully',
                    beneficiary_id: beneficiaryId,
                    asset_id,
                } satisfies ScreenDataPayload['SUCCESS_FEEDBACK_SCREEN'],
            };
        } catch (error) {
            const parsedError = parseUnknownError(error);

            logger.error('Failed to add beneficiary', {
                error: parsedError,
            });

            return {
                screen: AddBeneficiaryFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: parsedError.message,
                } satisfies ScreenDataPayload['ERROR_FEEDBACK_SCREEN'],
            };
        }
    }

    private static async getFeedbackScreenDataForAddingMobileMoneyBeneficiary(
        input: DataExchangePayload['MOBILE_MONEY_FORM_SCREEN']
    ) {
        const {
            country_code,
            channel_id,
            mobile_provider,
            first_name,
            last_name,
            mobile_number,
            asset_id,
            user_id,
            supported_mobile_providers,
        } = input;

        const selectedMobileProvider = this.determineSelectedMobileProvider(
            mobile_provider,
            supported_mobile_providers
        );

        try {
            const supportedCountries = await FiatRampService.getSupportedCurrencies();
            const country = supportedCountries.find((country) => country.code === country_code);

            if (!country) {
                throw new Error('Invalid country code');
            }

            const beneficiaryId = await FiatRampService.createBeneficiary(
                user_id,
                country_code as CountryCode,
                'phone',
                {
                    beneficiary: {
                        firstName: first_name,
                        lastName: last_name,
                        mobileNumber: mobile_number,
                        mobileProvider: selectedMobileProvider.providerName,
                        networkId: selectedMobileProvider.networkId,
                        channelId: channel_id,
                        countryId: country.id,
                        mobileProviderCode: selectedMobileProvider.providerCode,
                    },
                }
            );

            return {
                screen: AddBeneficiaryFlowScreens.SUCCESS_FEEDBACK,
                data: {
                    message: 'Beneficiary added successfully',
                    beneficiary_id: beneficiaryId,
                    asset_id,
                } satisfies ScreenDataPayload['SUCCESS_FEEDBACK_SCREEN'],
            };
        } catch (error) {
            const parsedError = parseUnknownError(error);

            logger.error('Failed to add beneficiary', {
                error: parsedError,
            });

            return {
                screen: AddBeneficiaryFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: parsedError.message,
                } satisfies ScreenDataPayload['ERROR_FEEDBACK_SCREEN'],
            };
        }
    }
}

export default WhatsAppBotAddBeneficiaryFlowService;
