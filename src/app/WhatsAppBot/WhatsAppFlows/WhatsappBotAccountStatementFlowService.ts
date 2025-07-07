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
import { accountStatementDateRangeSchema } from './schema';
import { UserV2Record } from '@/db/xata';
import { SIXTEEN } from '@/constants/numbers';
import { getFlowConfig } from './config';
import env from '@/constants/env';
import { FlowMode } from './types';
import { SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { addJobToAccountStatementQueue } from '@/app/account-statement/queue-utils';
import { formatDate } from 'date-fns';

enum AccountStatementFlowScreens {
    TRANSACTION_DATE_RANGE = 'TRANSACTION_DATE_RANGE',
    FEEDBACK = 'FEEDBACK',
}

type ScreenDataPayload = {
    TRANSACTION_DATE_RANGE_SCREEN: {
        start_date: string;
        end_date: string;
        user_id: string;
        end_date_max?: string;
        user_address?: string;
        error_messages?: {
            start_date?: string;
            end_date?: string;
            user_address?: string;
        };
        initial_values?: {
            start_date?: string;
            end_date?: string;
        };
    };
};

type DataExchangePayload = {
    TRANSACTION_DATE_RANGE_SCREEN: {
        start_date: string;
        end_date: string;
        user_id: string;
        user_address: string;
    };
};

const flowConfig = getFlowConfig('ACCOUNT_STATEMENT', env.WA_PHONE_NUMBER_ID);

class WhatsappBotAccountStatementFlowService {
    private static readonly FLOW_MODE: FlowMode = flowConfig.flowMode;
    public static readonly FLOW_ID = flowConfig.flowId;
    private static readonly INITIAL_SCREEN = AccountStatementFlowScreens.TRANSACTION_DATE_RANGE;

    public static async receiveDataExchange(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ): Promise<DataExchangeResponse> {
        const { action, screen, data } = requestBody;

        if (action === 'INIT') {
            // Using Preview data
        }

        if (action === 'data_exchange') {
            if (screen === AccountStatementFlowScreens.TRANSACTION_DATE_RANGE) {
                const nextScreenData = await this.getAccountStatementFlow(
                    data as DataExchangePayload['TRANSACTION_DATE_RANGE_SCREEN']
                );

                if (!nextScreenData) {
                    throw new Error('Unhandled screen');
                }

                return {
                    ...nextScreenData,
                    version: requestBody.version,
                };
            }
        }

        throw new Error('Unhandled action');
    }

    public static generateAccountStatementFlowInitMessage(
        user: UserV2Record,
        recipient: { userPhoneNumber: string }
    ) {
        const { userPhoneNumber } = recipient;

        const flowMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'flow',
                body: {
                    text: 'Click the button below to generate account statement',
                },
                action: {
                    name: 'flow',
                    parameters: {
                        flow_message_version: '3',
                        flow_token: generateRandomHexString(SIXTEEN),
                        flow_id: this.FLOW_ID,
                        mode: this.FLOW_MODE,
                        flow_cta: 'Generate Statement',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: this.INITIAL_SCREEN,
                            data: {
                                user_id: convertAsciiStringToBase64(user.id),
                                start_date: '2024-01-01',
                                end_date: formatDate(new Date(), 'yyyy-MM-dd'),
                                end_date_max: formatDate(new Date(), 'yyyy-MM-dd'),
                                user_address: 'Lagos',
                            } satisfies ScreenDataPayload['TRANSACTION_DATE_RANGE_SCREEN'],
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

    private static async getAccountStatementFlow(
        data: DataExchangePayload['TRANSACTION_DATE_RANGE_SCREEN']
    ) {
        const { user_id, ...formData } = data;

        const user = await userServiceV2.getUserById(convertBase64ToAsciiString(user_id));

        if (!user) {
            throw new Error('User not found');
        }

        const userId = user.id;

        const dataValidation = accountStatementDateRangeSchema.safeParse(formData);

        const errorMessages: Record<string, string | undefined> = {
            start_date: dataValidation.error?.flatten().fieldErrors?.start_date?.[0],
            end_date: dataValidation.error?.flatten().fieldErrors?.end_date?.[0],
            user_address: dataValidation.error?.flatten().fieldErrors?.user_address?.[0],
        };

        // Add custom error if user.address is null
        if (!user.address && !formData.user_address?.trim()) {
            errorMessages.user_address =
                "We couldn't find your address. Please fill in your address to proceed.";
        }

        if (!dataValidation.success || (!user.address && !formData.user_address?.trim())) {
            return {
                action: 'data_exchange',
                screen: AccountStatementFlowScreens.TRANSACTION_DATE_RANGE,
                data: {
                    user_id: convertAsciiStringToBase64(userId),
                    error_messages: errorMessages,
                    initial_values: { ...formData },
                    start_date: formData.start_date,
                    end_date: formData.end_date,
                } satisfies ScreenDataPayload['TRANSACTION_DATE_RANGE_SCREEN'],
            };
        }

        await addJobToAccountStatementQueue({
            whatsappParams: {
                businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                userPhoneNumber: user?.primaryWhatsappPhoneNumber as string,
            },
            startDate: formData.start_date,
            endDate: formData.end_date,
            user,
            newUserAddress: formData.user_address,
        });

        return {
            screen: AccountStatementFlowScreens.FEEDBACK,
            data: {
                status: 'Account statement request sent.',
                message: `Your account statement is being prepared. We'll send updates on your request's status directly to your DM.`,
                icon_src: SUCCESS_FEEDBACK_ICON,
            },
        };
    }
}

export default WhatsappBotAccountStatementFlowService;
