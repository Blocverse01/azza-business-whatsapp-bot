import FiatRampService from '@/app/FiatRamp/FiatRampService';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { getFlowConfig } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import { DropdownOption, FlowMode } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import env from '@/constants/env';
import { ERROR_FEEDBACK_ICON, SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { SIXTEEN } from '@/constants/numbers';
import logger from '@/resources/logger';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import { generateRandomHexString } from '@/resources/utils/encryption';
import { standardizePhoneNumberOrReturnError } from '@/resources/utils/phone-numbers';
import { AssetConfig } from '@/resources/web3/core/tokens';
import { type CountryCode } from 'libphonenumber-js';
import { extractIdFromString } from './schema';

enum AddBeneficiaryFlowScreens {
    ACCOUNT_TYPE = 'ACCOUNT_TYPE',
    BANK_ACCOUNT_FORM = 'BANK_ACCOUNT_FORM',
    BANK_ACCOUNT_SUMMARY = 'BANK_ACCOUNT_SUMMARY',
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
        can_edit_account_name: boolean;
        init_values?: {
            bank?: string;
            account_name?: string;
            account_number?: string;
        };
        resolved_account_name?: string;
        button_label: string;
        error_messages?: {
            account_number?: string;
        };
    };
    BANK_ACCOUNT_SUMMARY: {
        account_name: string;
        account_number: string;
        bank_name: string;
        channel_id: string;
        network_id: string;
        country_code: string;
        user_id: string;
        asset_id: string;
    };
    MOBILE_MONEY_FORM_SCREEN: {
        supported_mobile_providers: Array<Required<DropdownOption>>;
        country_code: string;
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
    SUCCESS_FEEDBACK_SCREEN: {
        message: string;
        beneficiary_id: string;
        asset_id: string;
        icon_src: string;
    };
    ERROR_FEEDBACK_SCREEN: {
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
        can_edit_account_name: boolean;
        resolved_account_name?: string;
    };
    BANK_ACCOUNT_SUMMARY: {
        country_code: string;
        channel_id: string;
        network_id: string;
        bank_name: string;
        account_name: string;
        account_number: string;
        asset_id: string;
        user_id: string;
        confirm_correct_details: boolean;
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
                    nextScreenData = await this.handleDataExchangeFromBankAccountFormScreen(
                        data as DataExchangePayload['BANK_ACCOUNT_FORM_SCREEN']
                    );

                    break;
                case AddBeneficiaryFlowScreens.BANK_ACCOUNT_SUMMARY:
                    nextScreenData = await this.getFeedbackScreenDataForAddingBankBeneficiary(
                        data as DataExchangePayload['BANK_ACCOUNT_SUMMARY']
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
            country_code as CountryCode,
            selectedAccountType.channelId
        );

        const canEditAccountName =
            !FiatRampService.supportedCountriesForResolvingBankAccount.includes(
                country_code.toUpperCase()
            );

        return {
            screen: AddBeneficiaryFlowScreens.BANK_ACCOUNT_FORM,
            data: {
                supported_banks: supportedBanks.map((bank) => ({
                    title: bank.name,
                    id:
                        country_code === 'NG'
                            ? `networkId:${bank.networkId}:seerbitId:${bank.seerbitId}`
                            : `${bank.networkId}`,
                })),
                country_code,
                channel_id: selectedAccountType.channelId,
                asset_id,
                user_id,
                can_edit_account_name: canEditAccountName,
                button_label: 'Verify Account Details',
            } satisfies ScreenDataPayload['BANK_ACCOUNT_FORM_SCREEN'],
        };
    }

    private static async getMobileMoneyAccountFormScreenData(
        input: DataExchangePayload['ACCOUNT_TYPE_SCREEN']
    ) {
        const { account_types, account_type, asset_id, user_id, country_code } = input;

        const selectedAccountType = this.determineSelectedAccountType(account_type, account_types);

        const supportedProviders = await FiatRampService.getSupportedMobileProviders(
            country_code as CountryCode,
            selectedAccountType.channelId
        );

        return {
            screen: AddBeneficiaryFlowScreens.MOBILE_MONEY_FORM,
            data: {
                supported_mobile_providers: supportedProviders.map((provider) => ({
                    title: provider.name,
                    id: provider.networkId,
                    description: provider.name,
                })),
                country_code,
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
            channel_id,
            bank,
            account_name,
            account_number,
            asset_id,
            user_id,
            supported_banks,
            can_edit_account_name,
        } = input;

        const selectedBank = this.determineSelectedBank(bank, supported_banks);

        let resolvedBankAccount: Awaited<ReturnType<typeof FiatRampService.resolveBankAccount>> =
            null;

        if (
            !can_edit_account_name &&
            FiatRampService.supportedCountriesForResolvingBankAccount.includes(
                country_code.toUpperCase()
            )
        ) {
            resolvedBankAccount = await FiatRampService.resolveBankAccount({
                networkId:
                    country_code === 'NG'
                        ? extractIdFromString({ input: selectedBank.networkId, key: 'networkId' })
                        : selectedBank.networkId,
                accountNumber: account_number.trim(),
                seerbitId:
                    country_code === 'NG'
                        ? extractIdFromString({ input: selectedBank.networkId, key: 'seerbitId' })
                        : '',
                countryCode: country_code.toUpperCase(),
            });
        }

        if (!resolvedBankAccount && !account_name) {
            return {
                screen: AddBeneficiaryFlowScreens.BANK_ACCOUNT_FORM,
                data: {
                    country_code,
                    channel_id,
                    asset_id,
                    user_id,
                    supported_banks,
                    can_edit_account_name: false,
                    error_messages: {
                        account_number: `Invalid account number for ${selectedBank.bankName}`,
                    },
                    button_label: 'Verify Account Details',
                    init_values: {
                        bank,
                        account_name,
                        account_number,
                    },
                } satisfies ScreenDataPayload['BANK_ACCOUNT_FORM_SCREEN'],
            };
        }

        return {
            screen: AddBeneficiaryFlowScreens.BANK_ACCOUNT_SUMMARY,
            data: {
                account_name: resolvedBankAccount?.accountName ?? account_name,
                account_number,
                bank_name: selectedBank.bankName,
                channel_id,
                network_id: `${selectedBank.networkId}:nameEnquiryReference:${resolvedBankAccount?.sessionId}`,
                country_code,
                user_id,
                asset_id,
            } satisfies ScreenDataPayload['BANK_ACCOUNT_SUMMARY'],
        };
    }

    private static async getFeedbackScreenDataForAddingBankBeneficiary(
        input: DataExchangePayload['BANK_ACCOUNT_SUMMARY']
    ) {
        const {
            country_code,
            channel_id,
            network_id,
            account_name,
            account_number,
            bank_name,
            asset_id,
            user_id,
        } = input;

        try {
            const supportedCountries = await FiatRampService.getSupportedCurrencies();

            const country = supportedCountries.find((country) => country.code === country_code);

            if (!country) {
                throw new Error('Invalid country code');
            }

            //add safehaven details
            const beneficiaryId = await FiatRampService.createBeneficiary(
                user_id,
                country_code as CountryCode,
                'bank',
                {
                    beneficiary: {
                        accountName: account_name.trim(),
                        accountNumber: account_number.trim(),
                        bankName: bank_name,
                        networkId:
                            country_code === 'NG'
                                ? extractIdFromString({ input: network_id, key: 'networkId' })
                                : network_id,
                        seerbitId:
                            country_code === 'NG'
                                ? extractIdFromString({ input: network_id, key: 'seerbitId' })
                                : '',
                        nameEnquiryReference:
                            country_code === 'NG'
                                ? extractIdFromString({
                                      input: network_id,
                                      key: 'nameEnquiryReference',
                                  })
                                : '',
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
                    icon_src: SUCCESS_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['SUCCESS_FEEDBACK_SCREEN'],
            };
        } catch (error) {
            const parsedError = parseUnknownError(error);

            void logger.error('Failed to add beneficiary', {
                error: parsedError,
            });

            return {
                screen: AddBeneficiaryFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: parsedError.message,
                    icon_src: ERROR_FEEDBACK_ICON,
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

            const [standardPhoneNumber, error] = standardizePhoneNumberOrReturnError(
                mobile_number,
                country.code.toUpperCase() as CountryCode
            );

            if (error !== null) {
                return {
                    screen: AddBeneficiaryFlowScreens.MOBILE_MONEY_FORM,
                    data: {
                        supported_mobile_providers: supported_mobile_providers,
                        country_code,
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

            const beneficiaryId = await FiatRampService.createBeneficiary(
                user_id,
                country_code as CountryCode,
                'phone',
                {
                    beneficiary: {
                        firstName: first_name,
                        lastName: last_name,
                        mobileNumber: standardPhoneNumber,
                        mobileProvider: selectedMobileProvider.providerName,
                        networkId: selectedMobileProvider.networkId,
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
                    icon_src: SUCCESS_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['SUCCESS_FEEDBACK_SCREEN'],
            };
        } catch (error) {
            const parsedError = parseUnknownError(error);

            void logger.error('Failed to add beneficiary', {
                error: parsedError,
            });

            return {
                screen: AddBeneficiaryFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: parsedError.message,
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['ERROR_FEEDBACK_SCREEN'],
            };
        }
    }
}

export default WhatsAppBotAddBeneficiaryFlowService;
