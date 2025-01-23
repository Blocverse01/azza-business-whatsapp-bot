import { transactionPinSchema } from '@/app/azza/azza.schema';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { FlowConfig, getFlowConfig, PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import { FeedbackScreenPayload } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import { queues } from '@/background-processing/queues';
import env from '@/constants/env';
import { SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { SIXTEEN } from '@/constants/numbers';
import { UserV2Record } from '@/db/xata';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
    generateRandomHexString,
} from '@/resources/utils/encryption';
import { compareHashedString, hashString } from '@/resources/utils/hashing';
import userServiceV2 from '@/runtime/user';

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
        const { action, screen, data } = requestBody;

        if (action === 'INIT') {
            // Using Preview data
        }

        if (action === 'data_exchange') {
            let nextScreenData: Omit<DataExchangeResponse, 'version'> | undefined;
            switch (screen) {
                case ChangeTransactionPinFlowScreens.ENTER_OLD_PIN_NEW_PIN:
                    nextScreenData = await this.completeChangeTransactionPinFlow(
                        data as DataExchangePayload['ENTER_OLD_PIN_NEW_PIN']
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

    public static createTransactionPinChangeFlowMessage(
        user: UserV2Record,
        params: {
            messageRecipient: string;
            messageBody: string;
            flowCTA: string;
        }
    ) {
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
                                user_id: convertAsciiStringToBase64(user.id),
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
        data: DataExchangePayload['ENTER_OLD_PIN_NEW_PIN']
    ) {
        const { new_pin, old_pin, confirm_new_pin, user_id } = data;

        const unmaskedUserId = convertBase64ToAsciiString(user_id);
        const user = await userServiceV2.getUserById(unmaskedUserId);

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

        const hashedPin = await hashString(new_pin);

        // Save the transaction pin in background
        await queues.userTxPinSecurity.add(
            'change-tx-pin',
            {
                newPinHash: hashedPin,
                userId: user_id,
                whatsappParams: {
                    businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                    userPhoneNumber: convertAsciiStringToBase64(user.primaryWhatsappPhoneNumber!),
                },
            },
            {
                removeOnComplete: true,
                removeOnFail: {
                    age: 24 * 3600, // keep up to 24 hours
                },
            }
        );

        // Update user's transaction pin in background
        // spawnInBackground<ChangeTransactionPinParams>(
        //     {
        //         newPinHash: hashedPin,
        //         userId: user_id,
        //     },
        //     CHANGE_TRANSACTION_PIN_SCRIPT_PATH
        // );

        return {
            screen: ChangeTransactionPinFlowScreens.FEEDBACK,
            data: {
                feedback_title: 'Transaction PIN update request sent successfully',
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
