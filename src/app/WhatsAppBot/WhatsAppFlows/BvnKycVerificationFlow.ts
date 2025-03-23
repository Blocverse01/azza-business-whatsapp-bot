import userServiceV2 from '@/runtime/user';
import {
    DecryptedFlowDataExchange,
    DataExchangeResponse,
    WhatsAppInteractiveMessage,
} from '../WhatsAppBotType';
import { FlowConfig, PhoneNumberId, getFlowConfig } from './config';
import { bvnKycVerificationSchema } from './schema';
import SmileIdService from '@/app/SmileID/SmileIdService';
import { SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { userIdentityInfoSchema } from '@/app/User/userSchema';
import { HttpException } from '@/resources/exceptions/HttpException';
import { BAD_REQUEST } from '@/constants/status-codes';
import { UserV2Record } from '@/db/xata';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
    generateRandomHexString,
} from '@/resources/utils/encryption';
import { SIXTEEN } from '@/constants/numbers';

enum BvnKycVerificationFlowScreens {
    SUBMIT_KYC = 'SUBMIT_KYC',
    PROCESSING_FEEDBACK = 'PROCESSING_FEEDBACK',
}

type ScreenDataPayload = {
    [BvnKycVerificationFlowScreens.SUBMIT_KYC]: {
        user_id: string;
        error_messages?: {
            bvn?: string;
            email?: string;
        };
        initial_values?: {
            bvn?: string;
            email?: string;
        };
    };
    [BvnKycVerificationFlowScreens.PROCESSING_FEEDBACK]: {
        icon_src: string;
        status: string;
        message: string;
    };
};

type DataExchangePayload = {
    [BvnKycVerificationFlowScreens.SUBMIT_KYC]: {
        bvn: string;
        email: string;
        user_id: string;
    };
};

const KYC_STATUS_MESSAGES = {
    PROCESSING: "Your KYC is processing and we'll update you once it's completed.",
    VERIFIED: 'Your KYC is verified and you can now start using the app.',
};

class BvnKycVerificationFlow {
    private static flowConfig: FlowConfig;
    private static readonly INITIAL_SCREEN = BvnKycVerificationFlowScreens.SUBMIT_KYC;

    public static withPhoneNumberId(phoneNumberId: PhoneNumberId) {
        this.flowConfig = getFlowConfig('BVN_KYC_VERIFICATION', phoneNumberId);
        return this;
    }

    public static async receiveDataExchange(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ): Promise<DataExchangeResponse> {
        const { action, screen, data } = requestBody;

        if (action === 'data_exchange') {
            if (screen === BvnKycVerificationFlowScreens.SUBMIT_KYC) {
                const nextScreenData = await this.completeBvnKycVerificationFlow(
                    data as DataExchangePayload['SUBMIT_KYC']
                );

                return {
                    ...nextScreenData,
                    version: requestBody.version,
                };
            }
        }

        throw new Error('Unhandled action');
    }

    public static createBvnVerificationFlowMessage(
        user: UserV2Record,
        params: {
            messageRecipient: string;
            messageBody: string;
            flowCTA: string;
            initialValues?: {
                bvn?: string;
                email?: string;
            };
        }
    ) {
        const { messageRecipient, messageBody, flowCTA, initialValues } = params;

        const flowMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'flow',
                body: {
                    text: messageBody,
                },
                action: {
                    name: 'flow',
                    parameters: {
                        flow_message_version: '3',
                        flow_token: generateRandomHexString(SIXTEEN),
                        flow_id: this.flowConfig.flowId,
                        mode: this.flowConfig.flowMode,
                        flow_cta: flowCTA,
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: this.INITIAL_SCREEN,
                            data: {
                                user_id: convertAsciiStringToBase64(user.id),
                                initial_values: initialValues,
                            } satisfies ScreenDataPayload['SUBMIT_KYC'],
                        },
                    },
                },
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: messageRecipient,
        };

        return flowMessage;
    }

    private static async completeBvnKycVerificationFlow(data: DataExchangePayload['SUBMIT_KYC']) {
        const { user_id, ...formData } = data;

        const decodedUserId = convertBase64ToAsciiString(user_id);
        const user = await userServiceV2.getUserById(decodedUserId);

        if (!user) {
            throw new Error('User not found');
        }

        const kycStatus = userServiceV2.formatKycStatus(user.kycStatus);

        if (kycStatus === 'verified') {
            throw new Error('User already verified');
        }

        const userDataValidation = userIdentityInfoSchema.safeParse({
            ...user,
            kycStatus,
            phoneNumber: user.primaryWhatsappPhoneNumber,
        });

        if (!userDataValidation.success) {
            throw new HttpException(BAD_REQUEST, 'Invalid user data', user);
        }

        const dataValidation = bvnKycVerificationSchema.safeParse(formData);

        if (!dataValidation.success) {
            return {
                action: 'data_exchange',
                screen: BvnKycVerificationFlowScreens.SUBMIT_KYC,
                data: {
                    user_id,
                    error_messages: {
                        bvn: dataValidation.error.flatten().fieldErrors?.bvn?.[0],
                        email: dataValidation.error.flatten().fieldErrors?.email?.[0],
                    },
                    initial_values: formData,
                } satisfies ScreenDataPayload['SUBMIT_KYC'],
            };
        }

        const { bvn, email } = dataValidation.data;
        const userData = userDataValidation.data;

        const [firstName, middleName] = userData.firstName.split(' ') ?? [];

        const response = await SmileIdService.verifyBvnAsync(decodedUserId, {
            dob: userData.kycDateOfBirth,
            first_name: firstName,
            gender: userData.gender ?? '',
            last_name: userData.lastName,
            phone_number: userData.phoneNumber,
            id_number: bvn,
            middle_name: middleName,
        });

        if (response.success) {
            await userServiceV2.updateUserInfo(user, {
                email: email,
            });

            return {
                action: 'data_exchange',
                screen: BvnKycVerificationFlowScreens.PROCESSING_FEEDBACK,
                data: {
                    icon_src: SUCCESS_FEEDBACK_ICON,
                    message: KYC_STATUS_MESSAGES.PROCESSING,
                    status: 'Processing',
                } satisfies ScreenDataPayload['PROCESSING_FEEDBACK'],
            };
        } else {
            return {
                action: 'data_exchange',
                screen: BvnKycVerificationFlowScreens.SUBMIT_KYC,
                data: {
                    user_id,
                    error_messages: {
                        bvn: 'An error occurred while submitting BVN data, please retry',
                    },
                    initial_values: formData,
                } satisfies ScreenDataPayload['SUBMIT_KYC'],
            };
        }
    }
}

export default BvnKycVerificationFlow;
