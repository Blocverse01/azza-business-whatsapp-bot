import userServiceV2 from '@/runtime/user';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '../WhatsAppBotType';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
} from '@/resources/utils/encryption';
import {
    FLOW_STEPS,
    bindFlowRequest,
    issueFlowToken,
} from '@/app/WhatsAppBot/WhatsAppFlows/flowSession';
import { UserV2Record } from '@/db/xata';
import { HUNDRED, SIX } from '@/constants/numbers';
import { getFlowConfig } from './config';
import env from '@/constants/env';
import { DropdownOption, FlowMode } from './types';
import { ERROR_FEEDBACK_ICON, SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { formatNumberAsCurrency, prettifyNumber } from '@/resources/utils/currency';
import { TransactionStatus } from '@/app/FiatRamp/fiatRampSchema';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import WhatsAppBotService from '../WhatsAppBotService';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { divide } from 'mathjs';
import { compareHashedString } from '@/resources/utils/hashing';
import { addNgnVasPaymentJobForProcessing } from '@/app/ngn-vas-payment/queue-utils';
import { VASServiceType } from '@/app/NigeriaBanks/SafeHaven/SafeHaveSchema';
import SafeHavenService from '@/app/NigeriaBanks/SafeHaven/SafeHavenService';
import { phoneNumberSchema } from './schema';
import { NGN_VAS_PLATFORM_PERCENTAGE } from '@/app/NigeriaBanks/SafeHaven/constants';

enum DataBundleFlowScreens {
    DATA_PURCHASE_DETAILS = 'DATA_PURCHASE_DETAILS',
    DATA_BUNDLE_DETAILS = 'DATA_BUNDLE_DETAILS',
    DATA_PURCHASE_SUMMARY = 'DATA_PURCHASE_SUMMARY',
    SUCCESS_FEEDBACK = 'SUCCESS_FEEDBACK',
    ERROR_FEEDBACK = 'ERROR_FEEDBACK',
    PROCESSING_FEEDBACK = 'PROCESSING_FEEDBACK',
}

type ScreenDataPayload = {
    DATA_PURCHASE_DETAILS: {
        airtime_networks: Array<DropdownOption>;
        recipient_phone_number: number;
        user_id: string;
        error_messages?: {
            recipient_phone_number?: string;
        };
        init_values?: {
            airtime_network: string;
        };
    };
    DATA_BUNDLE_DETAILS: {
        user_id: string;
        airtime_network: string;
        recipient_phone_number: number;
        service_category_id: string;
        assets: Array<DropdownOption>;
        data_bundles: Array<DropdownOption>;
        raw_data_bundles: Array<DropdownOption>;
        init_values?: {};
    };
    DATA_PURCHASE_SUMMARY: {
        airtime_network: string;
        recipient_phone_number: number;
        local_amount: number;
        service_category_id: string;
        transaction_pin: string;
        asset: string;
        bundle_code: string;
        init_values?: {};
        display_data: {
            format_local_amount: string;
            format_bundle_code: string;
        };
        user_id: string;
    };
    FEEDBACK_SCREEN: {
        message: string;
        status?: TransactionStatus;
        icon_src: string;
    };
};

type DataExchangePayload = {
    DATA_PURCHASE_DETAILS: {
        airtime_network: string;
        airtime_networks: Array<DropdownOption>;
        recipient_phone_number: number;
        user_id: string;
        service_category_id: string;
    };
    DATA_BUNDLE_DETAILS: {
        airtime_network: string;
        airtime_networks: Array<DropdownOption>;
        recipient_phone_number: number;
        local_amount: number;
        service_category_id: string;
        transaction_pin: string;
        user_id: string;
        assets: Array<DropdownOption>;
        asset: string;
        data_bundles: Array<DropdownOption>;
        data_bundle: string;
        raw_data_bundles: Array<DropdownOption>;
        display_data: {
            format_local_amount: string;
            format_bundle_code: string;
        };
        bundle_code: string;
    };
    DATA_PURCHASE_SUMMARY: {
        airtime_network: string;
        airtime_networks: Array<DropdownOption>;
        recipient_phone_number: number;
        user_id: string;
        service_category_id: string;
        transaction_pin: string;
        local_amount: number;
        asset: string;
        bundle_code: string;
        display_data: {
            format_local_amount: string;
            format_bundle_code: string;
        };
    };
};

const flowConfig = getFlowConfig('NGN_DATA_BUNDLE', env.WA_PHONE_NUMBER_ID);

class WhatsappBotNgnAirtimeFlowService {
    private static FLOW_MODE: FlowMode = flowConfig.flowMode;
    public static readonly FLOW_ID = flowConfig.flowId;
    private static readonly INITIAL_SCREEN = DataBundleFlowScreens.DATA_PURCHASE_DETAILS;

    public static async receiveDataExchange(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ): Promise<DataExchangeResponse> {
        const { action, screen, data, flow_token } = requestBody;

        if (action === 'INIT') {
            // Using Preview data
        }

        if (action === 'data_exchange') {
            await bindFlowRequest(requestBody, 'NGN_DATA_BUNDLE');
            let nextScreenData: Omit<DataExchangeResponse, 'version'> | undefined;

            switch (screen) {
                case DataBundleFlowScreens.DATA_PURCHASE_DETAILS:
                    nextScreenData = await this.getBuyDataFlowData(
                        data as DataExchangePayload['DATA_PURCHASE_DETAILS']
                    );
                    break;
                case DataBundleFlowScreens.DATA_BUNDLE_DETAILS:
                    nextScreenData = await this.getBuyDataBundleFlowData(
                        data as DataExchangePayload['DATA_BUNDLE_DETAILS']
                    );
                    break;
                case DataBundleFlowScreens.DATA_PURCHASE_SUMMARY:
                    nextScreenData = await this.getPaymentScreenData(
                        data as DataExchangePayload['DATA_PURCHASE_SUMMARY'],
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

    public static async generateDataBundleFlowInitMessage(
        user: UserV2Record,
        params: {
            userPhoneNumber: string;
            mobileNetworks: Array<DropdownOption>;
        }
    ) {
        const { userPhoneNumber, mobileNetworks } = params;

        const flowMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'flow',
                body: {
                    text: 'Click the button below to buy airtime',
                },
                action: {
                    name: 'flow',
                    parameters: {
                        flow_message_version: '3',
                        flow_token: await issueFlowToken({
                            userId: user.id,
                            presentedUserId: convertAsciiStringToBase64(user.id),
                            flow: 'NGN_DATA_BUNDLE',
                            step: FLOW_STEPS.INIT,
                        }),
                        flow_id: this.FLOW_ID,
                        mode: this.FLOW_MODE,
                        flow_cta: 'Buy Data Bundle',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: this.INITIAL_SCREEN,
                            data: {
                                user_id: convertAsciiStringToBase64(user.id),
                                airtime_networks: mobileNetworks,
                                recipient_phone_number: 8128588858,
                                init_values: {
                                    airtime_network: '61efacc8da92348f9dde5f95',
                                },
                            } satisfies ScreenDataPayload['DATA_PURCHASE_DETAILS'],
                        },
                    },
                },
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: userPhoneNumber,
        };

        return flowMessage;
    }

    private static determineSelectedMobileNetworks(
        mobileNetwork: string,
        mobileNetworks: Array<DropdownOption>
    ) {
        const selectedMobileNetwork = mobileNetworks.find((type) => type.id === mobileNetwork);

        if (!selectedMobileNetwork) {
            throw new Error('Invalid mobile networks');
        }

        return {
            title: selectedMobileNetwork.title,
            id: selectedMobileNetwork.id,
        };
    }

    private static determineSelectedAssets(asset: string, assets: Array<DropdownOption>) {
        const selectedAsset = assets.find((type) => type.id === asset);

        if (!selectedAsset) {
            throw new Error('Invalid assets');
        }

        return {
            title: selectedAsset.title,
            id: selectedAsset.id,
            description: selectedAsset.description,
        };
    }

    private static determineSelectedDataBundle(asset: string, assets: Array<DropdownOption>) {
        const selectedAsset = assets.find((type) => type.id === asset);

        if (!selectedAsset) {
            throw new Error('Invalid assets');
        }

        return {
            title: selectedAsset.title,
            id: selectedAsset.id,
            description: selectedAsset.description,
        };
    }

    private static async getBuyDataFlowData(data: DataExchangePayload['DATA_PURCHASE_DETAILS']) {
        const { user_id, ...formData } = data;

        const { airtime_network, airtime_networks, recipient_phone_number } = formData;

        const user = await userServiceV2.getUserById(convertBase64ToAsciiString(user_id));

        if (!user) {
            throw new Error('User not found');
        }

        const userId = user.id;

        const selectedMobileNetwork = this.determineSelectedMobileNetworks(
            airtime_network,
            airtime_networks
        );

        // Parse inputs safely
        const parsedPhoneNumber = recipient_phone_number.toString();

        const dataValidation = phoneNumberSchema.safeParse({
            recipient_phone_number: parsedPhoneNumber,
        });

        const errorMessages: Record<string, string | undefined> = {
            recipient_phone_number:
                dataValidation.error?.flatten().fieldErrors?.recipient_phone_number?.[0],
        };

        if (!dataValidation.success) {
            return {
                action: 'data_exchange',
                screen: DataBundleFlowScreens.DATA_PURCHASE_DETAILS,
                data: {
                    error_messages: errorMessages,
                    init_values: {
                        airtime_network: selectedMobileNetwork.id,
                    },
                    recipient_phone_number: recipient_phone_number,
                    airtime_networks: airtime_networks,
                    user_id: convertAsciiStringToBase64(userId),
                } satisfies ScreenDataPayload['DATA_PURCHASE_DETAILS'],
            };
        }

        const cappedLocalAmount: number = 500;

        const [assets, dataBundles] = await Promise.all([
            WhatsAppBotService.getTopFiveEligibleAssetsByAmount(
                user,
                {
                    userPhoneNumber: user.primaryWhatsappPhoneNumber,
                    businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                },
                {},
                cappedLocalAmount
            ) ?? [],
            SafeHavenService.getSafeHavenDataVasServiceCategoryProducts(
                selectedMobileNetwork.id,
                cappedLocalAmount
            ),
        ]);

        if (assets.length === 0) {
            return {
                screen: DataBundleFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: 'Insufficient balance',
                    status: 'failed',
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['FEEDBACK_SCREEN'],
            };
        }

        return {
            screen: DataBundleFlowScreens.DATA_BUNDLE_DETAILS,
            data: {
                airtime_network: selectedMobileNetwork.title.toUpperCase(),
                recipient_phone_number: recipient_phone_number,
                assets: assets.map((asset) => ({
                    id: asset.assetId,
                    title: `${asset.tokenName} on ${asset.network}`,
                    description: asset.balance,
                })),
                data_bundles: dataBundles.map((bundle) => ({
                    id: bundle.id,
                    title: `${formatNumberAsCurrency(parseFloat(bundle.amount), 'NGN')} - ${bundle.bundleCode}`,
                    description: `Valid for ${bundle.validity}`,
                })),
                raw_data_bundles: dataBundles.map((bundle) => ({
                    id: bundle.id,
                    title: bundle.amount,
                    description: bundle.bundleCode,
                })),
                service_category_id: selectedMobileNetwork.id,
                user_id: convertAsciiStringToBase64(userId),
            } satisfies ScreenDataPayload['DATA_BUNDLE_DETAILS'],
        };
    }

    private static async getBuyDataBundleFlowData(
        input: DataExchangePayload['DATA_BUNDLE_DETAILS']
    ) {
        const {
            airtime_network,
            recipient_phone_number,
            service_category_id,
            asset,
            assets,
            data_bundles,
            data_bundle,
            raw_data_bundles,
            user_id,
        } = input;

        const userIdToAsciiString = convertBase64ToAsciiString(user_id);

        const userIdToBase64 = convertAsciiStringToBase64(userIdToAsciiString);

        const selectedAsset = this.determineSelectedAssets(asset, assets);

        const { title: bundleAmount, description: bundleCode } = this.determineSelectedDataBundle(
            data_bundle,
            raw_data_bundles
        );

        const selectedBundleCode = this.determineSelectedDataBundle(data_bundle, data_bundles);

        return {
            screen: DataBundleFlowScreens.DATA_PURCHASE_SUMMARY,
            data: {
                airtime_network: airtime_network,
                local_amount: parseFloat(bundleAmount),
                recipient_phone_number: recipient_phone_number,
                display_data: {
                    format_local_amount: ``,
                    format_bundle_code: `${selectedBundleCode.title}`,
                },
                service_category_id: service_category_id,
                user_id: userIdToBase64,
                asset: selectedAsset.id,
                bundle_code: bundleCode!,
                transaction_pin: '',
            } satisfies ScreenDataPayload['DATA_PURCHASE_SUMMARY'],
        };
    }

    private static async getPaymentScreenData(
        input: DataExchangePayload['DATA_PURCHASE_SUMMARY'],
        flowToken: string
    ) {
        const {
            airtime_network,
            recipient_phone_number,
            local_amount,
            service_category_id,
            transaction_pin,
            display_data,
            user_id,
            asset,
            bundle_code,
        } = input;

        const userIdToAsciiString = convertBase64ToAsciiString(user_id);

        const [sellRate, user] = await Promise.all([
            FiatRampService.getSellRate('NGN'),
            userServiceV2.getUserById(userIdToAsciiString),
        ]);

        const usdAmount = parseFloat(divide(local_amount, sellRate).toFixed(SIX));

        const isPinValid = await compareHashedString(
            transaction_pin,
            user?.transactionPinHash as string
        );

        if (!isPinValid) {
            return {
                screen: DataBundleFlowScreens.DATA_PURCHASE_SUMMARY,
                data: {
                    airtime_network: airtime_network,
                    recipient_phone_number: recipient_phone_number,
                    asset: asset,
                    display_data: {
                        format_local_amount: '',
                        format_bundle_code: display_data.format_bundle_code,
                    },
                    error_messages: {
                        transaction_pin: 'Incorrect transaction pin',
                    },
                    local_amount: local_amount,
                    bundle_code: bundle_code,
                    service_category_id: service_category_id,
                    user_id: convertAsciiStringToBase64(user?.id!),
                },
            };
        }

        try {
            const transactionFee = (NGN_VAS_PLATFORM_PERCENTAGE / HUNDRED) * usdAmount;
            const response = await addNgnVasPaymentJobForProcessing(
                `ngn_vas_payment-${flowToken}`,
                {
                    transactionDetailsParams: {
                        assetId: asset,
                        fiatAmount: local_amount,
                        usdAmount: usdAmount,
                        tokenAmountToDebit: usdAmount,
                        beneficiaryId: '',
                        userId: userIdToAsciiString,
                        platformFeePercentage: NGN_VAS_PLATFORM_PERCENTAGE,
                        conversionRate: parseFloat(sellRate.toString()),
                        transactionPin: transaction_pin,
                        transactionFeeUsd: transactionFee,
                        transactionType: 'NGN_VAS_PAYMENT',
                        userPhoneNumber: user?.primaryWhatsappPhoneNumber!,
                    },
                    ngnVasDetailsParams: {
                        type: VASServiceType.DATA,
                        payload: {
                            phoneNumber: recipient_phone_number.toString(),
                            amount: local_amount,
                            serviceCategoryId: service_category_id,
                            distributionName: airtime_network,
                            bundleCode: bundle_code,
                        },
                    },
                }
            );

            if (response.status === 'processing') {
                void WhatsAppBotService.sendArbitraryTextMessage(
                    user?.primaryWhatsappPhoneNumber as string,
                    response.message
                );
            }

            return {
                screen:
                    response.status === 'complete'
                        ? DataBundleFlowScreens.SUCCESS_FEEDBACK
                        : DataBundleFlowScreens.PROCESSING_FEEDBACK,
                data: {
                    status: response.status === 'complete' ? 'Complete' : 'Processing',
                    message: response.message,
                    icon_src:
                        response.status === 'processing'
                            ? SUCCESS_FEEDBACK_ICON
                            : ERROR_FEEDBACK_ICON,
                },
            };
        } catch (error) {
            await logServiceError(error, 'An error occurred while processing on-ramp transaction');

            return {
                screen: DataBundleFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: 'An unexpected error occurred',
                    // status: 'failed',
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['FEEDBACK_SCREEN'],
            };
        }
    }
}

export default WhatsappBotNgnAirtimeFlowService;
