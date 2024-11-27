import { ChangeTransactionPinParams, transactionPinSchema } from '@/app/azza/azza.schema';
import { CHANGE_TRANSACTION_PIN_SCRIPT_PATH } from '@/app/azza/backgroundSpawns/script-paths';
import { spawnInBackground } from '@/app/azza/backgroundSpawns/spawn-in-background';
import UserService from '@/app/User/UserService';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { FlowConfig, getFlowConfig, PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import { FeedbackScreenPayload } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import { SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { SIXTEEN } from '@/constants/numbers';
import { logSync } from '@/resources/logger';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
    generateRandomHexString,
} from '@/resources/utils/encryption';
import { compareHashedString } from '@/resources/utils/hashing';

enum ChangeTransactionPinFlowScreens {
    ENTER_OLD_PIN_NEW_PIN = 'ENTER_OLD_PIN_NEW_PIN',
    FEEDBACK = 'FEEDBACK',
}

type ScreenDataPayload = {
    [ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN]: {
        form_description: string;
        user_id: string;
        error_messages?: {
            old_pin?: string;
            new_pin?: string;
            confirm_new_pin?: string;
        };
        initial_values?: {
            old_pin: string;
            new_pin: string;
            confirm_new_pin: string;
        };
    };
    [ChangeTransactionPinFlowScreens.FEEDBACK]: FeedbackScreenPayload;
};

type DataExchangePayload = {
    [ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN]: {
        old_pin: string;
        new_pin: string;
        confirm_new_pin: string;
        user_id: string;
    };
};

const CHANGE_TRANSACTION_PIN_FORM_DESCRIPTION = 'Please enter your old pin and new pin';

class WhatsAppBotChangeTransactionPinFlowService {
    private static flowConfig: FlowConfig;
    private static INITIAL_SCREEN = ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN;

    public static withPhoneNumberId(phoneNumberId: PhoneNumberId) {
        this.flowConfig = getFlowConfig('CHANGE_TRANSACTION_PIN', phoneNumberId);
        return this;
    }

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
                case ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN:
                    nextScreenData = await this.completeChangeTransactionPinFlow(
                        data as DataExchangePayload['ENTER_OLD_PIN_NEW_PIN'],
                        flow_token
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

    public static createTransactionPinChangeFlowMessage(params: {
        messageRecipient: string;
        messageBody: string;
        flowCTA: string;
    }) {
        const { messageRecipient, messageBody, flowCTA } = params;

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
                                form_description: CHANGE_TRANSACTION_PIN_FORM_DESCRIPTION,
                                user_id: convertAsciiStringToBase64(messageRecipient),
                            } satisfies ScreenDataPayload['ENTER_OLD_PIN_NEW_PIN'],
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

    private static async completeChangeTransactionPinFlow(
        data: DataExchangePayload['ENTER_OLD_PIN_NEW_PIN'],
        flowToken: string
    ) {
        const { new_pin, old_pin, confirm_new_pin, user_id } = data;

        const unmaskedUserId = convertBase64ToAsciiString(user_id);
        const user = await UserService.getUserByPhoneNumber(unmaskedUserId);

        // Check 1: If user does not have a transaction pin set
        if (!user?.transactionPinHash) {
            return {
                screen: ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN,
                data: {
                    form_description: CHANGE_TRANSACTION_PIN_FORM_DESCRIPTION,
                    user_id,
                    error_messages: {
                        old_pin: 'Transaction PIN not set for your account.',
                    },
                    initial_values: {
                        ...data,
                    },
                } satisfies ScreenDataPayload[ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN],
            };
        }

        // Check 2: If old pin is incorrect
        const pinIsValid = await compareHashedString(old_pin, user.transactionPinHash!);

        if (!pinIsValid) {
            return {
                screen: ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN,
                data: {
                    form_description: CHANGE_TRANSACTION_PIN_FORM_DESCRIPTION,
                    user_id,
                    error_messages: {
                        old_pin: 'Incorrect transaction PIN.',
                    },
                    initial_values: {
                        ...data,
                    },
                } satisfies ScreenDataPayload[ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN],
            };
        }

        // Check 3: If transaction pin matches the allowed schema
        if (!transactionPinSchema.safeParse(new_pin).success) {
            return {
                screen: ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN,
                data: {
                    error_messages: {
                        new_pin: 'Transaction PIN should be 4 - 6 digits',
                    },
                    form_description: CHANGE_TRANSACTION_PIN_FORM_DESCRIPTION,
                    initial_values: {
                        ...data,
                    },
                    user_id,
                } satisfies ScreenDataPayload[ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN],
            };
        }

        // Check 3: If new pin and confirm new pin do not match
        if (new_pin !== confirm_new_pin) {
            return {
                screen: ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN,
                data: {
                    form_description: CHANGE_TRANSACTION_PIN_FORM_DESCRIPTION,
                    user_id,
                    error_messages: {
                        confirm_new_pin: 'New PINs do not match.',
                    },
                    initial_values: {
                        ...data,
                    },
                } satisfies ScreenDataPayload[ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN],
            };
        }

        // Update user's transaction pin in background
        // Save the transaction pin and security questions
        spawnInBackground<ChangeTransactionPinParams>(
            {
                newPin: new_pin,
                userId: convertBase64ToAsciiString(user_id),
            },
            CHANGE_TRANSACTION_PIN_SCRIPT_PATH
        );

        return {
            screen: ChangeTransactionPinFlowScreens.FEEDBACK,
            data: {
                feedback_title: 'Updating your Transaction PIN',
                feedback_message:
                    'The request to update your Transaction PIN has been sent successfully. You will receive a confirmation message once the update is complete.',
                feedback_sub_message:
                    'Click on the button below to return to continue using the bot.',
                footer_cta_text: 'Done',
                icon_src: SUCCESS_FEEDBACK_ICON,
            } satisfies ScreenDataPayload[ChangeTransactionPinFlowScreens.FEEDBACK],
        };
    }
}

export default WhatsAppBotChangeTransactionPinFlowService;
