import userServiceV2 from '@/runtime/user';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '../WhatsAppBotType';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
    generateRandomHexString,
} from '@/resources/utils/encryption';
import { airtimeSchema } from './schema';
import { UserV2Record } from '@/db/xata';
import { HUNDRED, SIX, SIXTEEN } from '@/constants/numbers';
import { getFlowConfig } from './config';
import env from '@/constants/env';
import { DropdownOption, FlowMode } from './types';
import { ERROR_FEEDBACK_ICON, SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { formatNumberAsCurrency } from '@/resources/utils/currency';
import { TransactionStatus } from '@/app/FiatRamp/fiatRampSchema';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import WhatsAppBotService from '../WhatsAppBotService';
import azzaWalletManager from '@/runtime/wallet';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { divide } from 'mathjs';
import { compareHashedString } from '@/resources/utils/hashing';
import { addNgnVasPaymentJobForProcessing } from '@/app/ngn-vas-payment/queue-utils';
import { VASServiceType } from '@/app/NigeriaBanks/SafeHaven/SafeHaveSchema';
import { NGN_VAS_PLATFORM_PERCENTAGE } from '@/app/NigeriaBanks/SafeHaven/constants';

enum AirtimeFlowScreens {
    AIRTIME_PURCHASE_DETAILS = 'AIRTIME_PURCHASE_DETAILS',
    AIRTIME_PURCHASE_SUMMARY = 'AIRTIME_PURCHASE_SUMMARY',
    SUCCESS_FEEDBACK = 'SUCCESS_FEEDBACK',
    ERROR_FEEDBACK = 'ERROR_FEEDBACK',
    PROCESSING_FEEDBACK = 'PROCESSING_FEEDBACK',
}

type ScreenDataPayload = {
    AIRTIME_PURCHASE_DETAILS: {
        airtime_networks: Array<DropdownOption>;
        recipient_phone_number: number;
        local_amount: number;
        user_id: string;
        error_messages?: {
            recipient_phone_number?: string;
            local_amount?: string;
        };
        init_values?: {
            local_amount: number;
            airtime_network: string;
        };
        display_data: {
            local_amount: string;
        };
    };
    AIRTIME_PURCHASE_SUMMARY: {
        airtime_network: string;
        recipient_phone_number: number;
        local_amount: number;
        service_category_id: string;
        assets: Array<DropdownOption>;
        asset: string;
        transaction_pin: string;
        init_values?: {};
        display_data: {
            local_amount: string;
        };
    };
    FEEDBACK_SCREEN: {
        message: string;
        status?: TransactionStatus;
        icon_src: string;
    };
};

type DataExchangePayload = {
    AIRTIME_PURCHASE_DETAILS: {
        airtime_network: string;
        airtime_networks: Array<DropdownOption>;
        recipient_phone_number: number;
        local_amount: number;
        user_id: string;
        service_category_id: string;
        display_data: {
            local_amount: string;
        };
    };
    AIRTIME_PURCHASE_SUMMARY: {
        airtime_network: string;
        recipient_phone_number: number;
        local_amount: number;
        service_category_id: string;
        asset_id: string;
        transaction_pin: string;
        user_id: string;
        assets: Array<DropdownOption>;
        asset: string;
        display_data: {
            local_amount: string;
        };
    };
};

const flowConfig = getFlowConfig('NGN_AIRTIME', env.WA_PHONE_NUMBER_ID);

class WhatsappBotNgnAirtimeFlowService {
    private static FLOW_MODE: FlowMode = flowConfig.flowMode;
    public static readonly FLOW_ID = flowConfig.flowId;
    private static readonly INITIAL_SCREEN = AirtimeFlowScreens.AIRTIME_PURCHASE_DETAILS;

    public static async receiveDataExchange(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ): Promise<DataExchangeResponse> {
        const { action, screen, data, flow_token } = requestBody;

        if (action === 'INIT') {
            // Using Preview data
        }

        if (action === 'data_exchange') {
            let nextScreenData: Omit<DataExchangeResponse, 'version'> | undefined;

            switch (screen) {
                case AirtimeFlowScreens.AIRTIME_PURCHASE_DETAILS:
                    nextScreenData = await this.getBuyAirtimeFlowData(
                        data as DataExchangePayload['AIRTIME_PURCHASE_DETAILS']
                    );
                    break;
                case AirtimeFlowScreens.AIRTIME_PURCHASE_SUMMARY:
                    nextScreenData = await this.getPaymentScreenData(
                        data as DataExchangePayload['AIRTIME_PURCHASE_SUMMARY'],
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

    public static generateAirtimeFlowInitMessage(
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
                        flow_token: generateRandomHexString(SIXTEEN),
                        flow_id: this.FLOW_ID,
                        mode: this.FLOW_MODE,
                        flow_cta: 'Buy Airtime',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: this.INITIAL_SCREEN,
                            data: {
                                user_id: convertAsciiStringToBase64(user.id),
                                airtime_networks: mobileNetworks,
                                recipient_phone_number: 8128588858,
                                local_amount: 500,
                                init_values: {
                                    airtime_network: '61efacc8da92348f9dde5f95',
                                    local_amount: 0,
                                },
                                display_data: {
                                    local_amount: '',
                                },
                            } satisfies ScreenDataPayload['AIRTIME_PURCHASE_DETAILS'],
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

    private static async getBuyAirtimeFlowData(
        data: DataExchangePayload['AIRTIME_PURCHASE_DETAILS']
    ) {
        const { user_id, ...formData } = data;

        const {
            airtime_network,
            airtime_networks,
            recipient_phone_number,
            local_amount,
            display_data,
        } = formData;

        // Parse inputs safely
        const parsedLocalAmount = Number(local_amount);
        const parsedPhoneNumber = recipient_phone_number.toString();

        const user = await userServiceV2.getUserById(convertBase64ToAsciiString(user_id));

        if (!user) {
            throw new Error('User not found');
        }

        const userId = user.id;

        const selectedMobileNetwork = this.determineSelectedMobileNetworks(
            airtime_network,
            airtime_networks
        );

        const dataValidation = airtimeSchema.safeParse({
            local_amount: parsedLocalAmount,
            recipient_phone_number: parsedPhoneNumber,
        });

        const errorMessages: Record<string, string | undefined> = {
            local_amount: dataValidation.error?.flatten().fieldErrors?.local_amount?.[0],
            recipient_phone_number:
                dataValidation.error?.flatten().fieldErrors?.recipient_phone_number?.[0],
        };

        if (!dataValidation.success) {
            return {
                action: 'data_exchange',
                screen: AirtimeFlowScreens.AIRTIME_PURCHASE_DETAILS,
                data: {
                    error_messages: errorMessages,
                    init_values: {
                        local_amount: parsedLocalAmount,
                        airtime_network: selectedMobileNetwork.id,
                    },
                    recipient_phone_number: recipient_phone_number,
                    local_amount: parsedLocalAmount,
                    airtime_networks: airtime_networks,
                    display_data: {
                        local_amount: formatNumberAsCurrency(
                            parseFloat(display_data.local_amount.toString()),
                            'NGN'
                        ),
                    },
                    user_id: convertAsciiStringToBase64(userId),
                } satisfies ScreenDataPayload['AIRTIME_PURCHASE_DETAILS'],
            };
        }

        //assets
        const assets =
            (await WhatsAppBotService.getTopFiveEligibleAssetsByAmount(
                user,
                {
                    userPhoneNumber: user.primaryWhatsappPhoneNumber,
                    businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                },
                {},
                parsedLocalAmount
            )) ?? [];

        if (assets.length === 0) {
            return {
                screen: AirtimeFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: 'Insufficient balance',
                    status: 'failed',
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['FEEDBACK_SCREEN'],
            };
        }

        return {
            screen: AirtimeFlowScreens.AIRTIME_PURCHASE_SUMMARY,
            data: {
                airtime_network: selectedMobileNetwork.title.toUpperCase(),
                recipient_phone_number: recipient_phone_number,
                display_data: {
                    local_amount: formatNumberAsCurrency(
                        parseFloat(display_data.local_amount.toString()),
                        'NGN'
                    ),
                },
                local_amount: parsedLocalAmount,
                assets: assets.map((asset) => ({
                    id: asset.assetId,
                    title: `${asset.tokenName} on ${asset.network}`,
                    description: asset.balance,
                })),
                service_category_id: selectedMobileNetwork.id,
                transaction_pin: '',
                user_id: convertAsciiStringToBase64(userId),
            },
        };
    }

    private static async getPaymentScreenData(
        input: DataExchangePayload['AIRTIME_PURCHASE_SUMMARY'],
        flowToken: string
    ) {
        const {
            airtime_network,
            recipient_phone_number,
            local_amount,
            service_category_id,
            asset,
            assets,
            transaction_pin,
            display_data,
            user_id,
        } = input;

        const userIdToAsciiString = convertBase64ToAsciiString(user_id);

        const userIdToBase64 = convertAsciiStringToBase64(userIdToAsciiString);

        const selectedAsset = this.determineSelectedAssets(asset, assets);

        const [userBalance, sellRate, user] = await Promise.all([
            azzaWalletManager.getAssetBalance({
                userId: userIdToAsciiString,
                assetId: selectedAsset.id,
            }),
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
                screen: AirtimeFlowScreens.AIRTIME_PURCHASE_SUMMARY,
                data: {
                    recipient_phone_number: recipient_phone_number,
                    display_data: {
                        local_amount: formatNumberAsCurrency(
                            parseFloat(display_data.local_amount.toString()),
                            'NGN'
                        ),
                    },
                    error_messages: {
                        transaction_pin: 'Incorrect transaction pin',
                    },
                    local_amount: local_amount,
                    assets: assets.map((asset) => ({
                        id: asset.id,
                        title: `${asset.title}`,
                        description: asset.description,
                    })),
                    service_category_id: service_category_id,
                    transaction_pin: '',
                    user_id: userIdToBase64,
                },
            };
        }

        try {
            const transactionFee = (NGN_VAS_PLATFORM_PERCENTAGE / HUNDRED) * usdAmount;

            const response = await addNgnVasPaymentJobForProcessing(
                `ngn_vas_payment-${flowToken}`,
                {
                    transactionDetailsParams: {
                        assetId: selectedAsset.id,
                        fiatAmount: parseFloat(local_amount.toString()),
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
                        type: VASServiceType.AIRTIME,
                        payload: {
                            phoneNumber: recipient_phone_number.toString(),
                            amount: local_amount,
                            serviceCategoryId: service_category_id,
                            distributionName: airtime_network,
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
                        ? AirtimeFlowScreens.SUCCESS_FEEDBACK
                        : AirtimeFlowScreens.PROCESSING_FEEDBACK,
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
                screen: AirtimeFlowScreens.ERROR_FEEDBACK,
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
