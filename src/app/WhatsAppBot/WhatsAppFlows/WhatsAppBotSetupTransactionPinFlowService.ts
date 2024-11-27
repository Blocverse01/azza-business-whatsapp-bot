import {
    SecurityQuestion,
    SetTransactionPinParams,
    transactionPinSchema,
} from '@/app/azza/azza.schema';
import { SET_TRANSACTION_PIN_SCRIPT_PATH } from '@/app/azza/backgroundSpawns/script-paths';
import { spawnInBackground } from '@/app/azza/backgroundSpawns/spawn-in-background';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { FlowConfig, getFlowConfig, PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import { FeedbackScreenPayload } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import { SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { SIXTEEN } from '@/constants/numbers';
import { RECOVERY_QUESTIONS } from '@/resources/data/recovery-questions';
import { logSync } from '@/resources/logger';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
    generateRandomHexString,
} from '@/resources/utils/encryption';

enum SetupTransactionPinFlowScreens {
    SET_TRANSACTION_PIN = 'SET_TRANSACTION_PIN',
    RECOVERY_QUESTIONS = 'RECOVERY_QUESTIONS',
}

const PIN_FORM_DESCRIPTION =
    'Please set a transaction pin. This pin will be used to authorize transactions on your account. It should be 4-6 digits long.';
const RECOVERY_QUESTIONS_FORM_DESCRIPTION =
    'Please set up your recovery questions. Answer at least 2 questions';
const MIN_RECOVERY_QUESTIONS_ERROR = 'Please answer at least 2 security questions';

const getRandomSecurityQuestions = (number: number) => {
    const questions = Object.values(RECOVERY_QUESTIONS);
    const randomQuestions = [];
    for (let i = 0; i < number; i++) {
        const randomIndex = Math.floor(Math.random() * questions.length);
        randomQuestions.push(questions[randomIndex]);
        questions.splice(randomIndex, 1);
    }
    return randomQuestions;
};

type ScreenDataPayload = {
    [SetupTransactionPinFlowScreens.SET_TRANSACTION_PIN]: {
        error_messages?: {
            transaction_pin?: string;
            confirm_transaction_pin?: string;
        };
        pin_form_description: string;
        user_id: string;
    };
    [SetupTransactionPinFlowScreens.RECOVERY_QUESTIONS]: {
        security_questions_form_description: string;
        [key: `question_${number}`]: {
            title: string;
            id: string;
        };
        transaction_pin: string;
        security_questions_error?: string;
        all_questions_list: Record<
            `question_${number}`,
            {
                title: string;
                id: string;
            }
        >;
        user_id: string;
    };
};
type DataExchangePayload = {
    SET_TRANSACTION_PIN: {
        transaction_pin: string;
        confirm_transaction_pin: string;
        user_id: string;
    };
    RECOVERY_QUESTIONS: {
        transaction_pin: string;
        user_id: string;
        [key: `question_${number}`]: string; // Answer to the question
        all_questions_list: Record<
            `question_${number}`,
            {
                title: string;
                id: string;
            }
        >;
    };
};

class WhatsAppBotSetupTransactionPinFlowService {
    private static flowConfig: FlowConfig;
    private static INITIAL_SCREEN = SetupTransactionPinFlowScreens.SET_TRANSACTION_PIN;

    public static withPhoneNumberId(phoneNumberId: PhoneNumberId) {
        this.flowConfig = getFlowConfig('SET_TRANSACTION_PIN', phoneNumberId);
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
                case SetupTransactionPinFlowScreens.SET_TRANSACTION_PIN:
                    nextScreenData = await this.getRecoveryQuestionsScreenData(
                        data as DataExchangePayload['SET_TRANSACTION_PIN']
                    );
                    break;
                case SetupTransactionPinFlowScreens.RECOVERY_QUESTIONS:
                    nextScreenData = await this.completeFlow(
                        data as DataExchangePayload['RECOVERY_QUESTIONS'],
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

    public static createSetupTransactionPinFlowMessage(params: {
        messageBody: string;
        messageRecipient: string;
    }) {
        const { messageBody, messageRecipient } = params;

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
                        flow_cta: 'Set up Transaction PIN',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: this.INITIAL_SCREEN,
                            data: {
                                pin_form_description: PIN_FORM_DESCRIPTION,
                                user_id: convertAsciiStringToBase64(messageRecipient),
                            } satisfies ScreenDataPayload['SET_TRANSACTION_PIN'],
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

    private static async getRecoveryQuestionsScreenData(
        data: DataExchangePayload['SET_TRANSACTION_PIN']
    ) {
        const { transaction_pin, confirm_transaction_pin, user_id } = data;

        if (!transactionPinSchema.safeParse(transaction_pin).success) {
            return {
                screen: SetupTransactionPinFlowScreens.SET_TRANSACTION_PIN,
                data: {
                    error_messages: {
                        transaction_pin: 'Invalid transaction pin',
                    },
                    pin_form_description: PIN_FORM_DESCRIPTION,
                    user_id: user_id,
                } as ScreenDataPayload[SetupTransactionPinFlowScreens.SET_TRANSACTION_PIN],
            };
        }

        if (transaction_pin !== confirm_transaction_pin) {
            return {
                screen: SetupTransactionPinFlowScreens.SET_TRANSACTION_PIN,
                data: {
                    error_messages: {
                        confirm_transaction_pin: 'Transaction pins do not match',
                    },
                    pin_form_description: PIN_FORM_DESCRIPTION,
                } as ScreenDataPayload[SetupTransactionPinFlowScreens.SET_TRANSACTION_PIN],
            };
        }

        const randomQuestions = getRandomSecurityQuestions(4);

        const SECURITY_QUESTIONS_TO_USE: Record<
            `question_${number}`,
            {
                title: string;
                id: string;
            }
        > = {
            question_1: randomQuestions[0],
            question_2: randomQuestions[1],
            question_3: randomQuestions[2],
            question_4: randomQuestions[3],
        } as const;

        return {
            screen: SetupTransactionPinFlowScreens.RECOVERY_QUESTIONS,
            data: {
                security_questions_form_description: RECOVERY_QUESTIONS_FORM_DESCRIPTION,
                ...SECURITY_QUESTIONS_TO_USE,
                transaction_pin: data.transaction_pin,
                user_id: data.user_id,
                all_questions_list: SECURITY_QUESTIONS_TO_USE,
            } as ScreenDataPayload[SetupTransactionPinFlowScreens.RECOVERY_QUESTIONS],
        };
    }

    private static async completeFlow(
        data: DataExchangePayload['RECOVERY_QUESTIONS'],
        flowToken: string
    ) {
        const {
            transaction_pin,
            question_1,
            question_2,
            question_3,
            question_4,
            user_id,
            all_questions_list,
        } = data;

        const questionsToSave: Array<SecurityQuestion> = [];

        [question_1 ?? '', question_2 ?? '', question_3 ?? '', question_4 ?? ''].forEach(
            (answerToQuestion, index) => {
                if (answerToQuestion?.trim() !== '') {
                    const targetQuestion = all_questions_list[`question_${index + 1}`];
                    questionsToSave.push({
                        question: targetQuestion.title,
                        answer: answerToQuestion,
                        immutableId: targetQuestion.id,
                    });
                }
            }
        );

        if (questionsToSave.length < 2) {
            return {
                screen: SetupTransactionPinFlowScreens.RECOVERY_QUESTIONS,
                data: {
                    security_questions_form_description: RECOVERY_QUESTIONS_FORM_DESCRIPTION,
                    ...all_questions_list,
                    transaction_pin: transaction_pin,
                    security_questions_error: MIN_RECOVERY_QUESTIONS_ERROR,
                    user_id: user_id,
                    all_questions_list,
                } as ScreenDataPayload[SetupTransactionPinFlowScreens.RECOVERY_QUESTIONS],
            };
        }

        // Save the transaction pin and security questions
        spawnInBackground<SetTransactionPinParams>(
            {
                pin: transaction_pin,
                securityQuestions: questionsToSave,
                userId: convertBase64ToAsciiString(user_id),
            },
            SET_TRANSACTION_PIN_SCRIPT_PATH
        );

        return {
            screen: 'FEEDBACK',
            data: {
                feedback_title: 'Setting up your Transaction PIN',
                feedback_message:
                    'Your transaction PIN and security questions are being set up. We will notify you once the setup is complete.',
                footer_cta_text: 'Done',
                feedback_sub_message:
                    'Click on the button below to return to continue using the bot.',
                icon_src: SUCCESS_FEEDBACK_ICON,
            } satisfies FeedbackScreenPayload,
        };
    }
}

export default WhatsAppBotSetupTransactionPinFlowService;
