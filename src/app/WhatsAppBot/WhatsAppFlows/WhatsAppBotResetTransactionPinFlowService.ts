import { SecurityQuestion, transactionPinSchema } from '@/app/azza/azza.schema';
import UserService from '@/app/User/UserService';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { FlowConfig, getFlowConfig, PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import { FeedbackScreenPayload } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import { queues } from '@/background-processing/queues';
import { SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { SIXTEEN } from '@/constants/numbers';
import { logSync } from '@/resources/logger';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
    generateRandomHexString,
} from '@/resources/utils/encryption';
import { hashString } from '@/resources/utils/hashing';

enum ResetTransactionPinFlowScreens {
    ANSWER_SECURITY_QUESTIONS = 'ANSWER_SECURITY_QUESTIONS',
    NEW_PIN = 'NEW_PIN',
    FEEDBACK = 'FEEDBACK',
}

type QuestionKey = `question_${number}`;

type ScreenDataPayload = {
    [ResetTransactionPinFlowScreens.ANSWER_SECURITY_QUESTIONS]: {
        form_description: string;
        user_id: string;
        [key: QuestionKey]: string;
        error_messages?: {
            [key: QuestionKey]: string;
        };
        error_summary?: string;
        initial_values?: {
            [key: QuestionKey]: string;
        };
        all_questions_list: Record<
            QuestionKey,
            {
                id: string;
                title: string;
            }
        >;
    };
    [ResetTransactionPinFlowScreens.NEW_PIN]: {
        form_description: string;
        user_id: string;
        error_messages?: {
            new_pin?: string;
            confirm_new_pin?: string;
        };
        initial_values?: {
            new_pin: string;
            confirm_new_pin: string;
        };
    };
    [ResetTransactionPinFlowScreens.FEEDBACK]: FeedbackScreenPayload;
};

type DataExchangePayload = {
    [ResetTransactionPinFlowScreens.ANSWER_SECURITY_QUESTIONS]: {
        [key: QuestionKey]: string;
        user_id: string;
        all_questions_list: Record<
            QuestionKey,
            {
                id: string;
                title: string;
            }
        >;
    };
    [ResetTransactionPinFlowScreens.NEW_PIN]: {
        new_pin: string;
        confirm_new_pin: string;
        user_id: string;
    };
};

const RESET_TRANSACTION_PIN_FORM_DESCRIPTION = 'Please provide answers to the security questions';
const NEW_TRANSACTION_PIN_FORM_DESCRIPTION = 'Create a new transaction PIN';

class WhatsAppBotResetTransactionPinFlowService {
    private static flowConfig: FlowConfig;
    private static INITIAL_SCREEN = ResetTransactionPinFlowScreens.ANSWER_SECURITY_QUESTIONS;

    public static withPhoneNumberId(phoneNumberId: PhoneNumberId) {
        this.flowConfig = getFlowConfig('RESET_TRANSACTION_PIN', phoneNumberId);
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
                case ResetTransactionPinFlowScreens.ANSWER_SECURITY_QUESTIONS:
                    nextScreenData = await this.getNewPinScreenData(
                        data as DataExchangePayload['ANSWER_SECURITY_QUESTIONS']
                    );
                    break;
                case ResetTransactionPinFlowScreens.NEW_PIN:
                    nextScreenData = await this.completeResetTransactionPinFlow(
                        data as DataExchangePayload['NEW_PIN']
                    );
            }

            if (!nextScreenData) {
                throw new Error('Unhandled screen');
            }

            logSync('debug', 'Next screen data', {
                screen: nextScreenData.screen,
                errors: nextScreenData.data?.error_messages,
                user_id: nextScreenData.data?.user_id,
            });

            return {
                ...nextScreenData,
                version: requestBody.version,
            };
        }

        throw new Error('Unhandled action');
    }

    public static createTransactionPinResetFlowMessage(params: {
        messageRecipient: string;
        messageBody: string;
        flowCTA: string;
        userSecurityQuestions: Array<Pick<SecurityQuestion, 'question' | 'immutableId'>>;
    }) {
        const { messageRecipient, messageBody, flowCTA, userSecurityQuestions } = params;

        const payloadSecurityQuestionEntries = userSecurityQuestions.map((question, index) => [
            `question_${index + 1}`,
            {
                id: question.immutableId,
                title: question.question,
            },
        ]);
        const payloadSecurityQuestions = Object.fromEntries(
            payloadSecurityQuestionEntries
        ) as Record<
            QuestionKey,
            {
                id: string;
                title: string;
            }
        >;

        const questionKeys = Object.keys(payloadSecurityQuestions) as Array<QuestionKey>;

        const questionsForDisplay = Object.fromEntries(
            questionKeys.map((key) => [key, payloadSecurityQuestions[key].title])
        );
        if (questionKeys.length < 4) {
            const remainingQuestionsCount = 4 - questionKeys.length;
            for (let i = 0; i < remainingQuestionsCount; i++) {
                questionsForDisplay[`question_${questionKeys.length + i + 1}`] = '';
            }
        }

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
                                form_description: RESET_TRANSACTION_PIN_FORM_DESCRIPTION,
                                user_id: convertAsciiStringToBase64(messageRecipient),
                                ...questionsForDisplay,
                                all_questions_list: payloadSecurityQuestions,
                            } satisfies ScreenDataPayload['ANSWER_SECURITY_QUESTIONS'],
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

    private static async getNewPinScreenData(
        data: DataExchangePayload['ANSWER_SECURITY_QUESTIONS']
    ) {
        const { user_id, all_questions_list } = data;

        const unmaskedUserId = convertBase64ToAsciiString(user_id);
        const user = await UserService.getUserByPhoneNumber(unmaskedUserId);

        const storedSecurityQuestionsConfig = user?.securityQuestionsSetup;

        if (!storedSecurityQuestionsConfig) {
            return {
                screen: ResetTransactionPinFlowScreens.ANSWER_SECURITY_QUESTIONS,
                data: {
                    form_description: RESET_TRANSACTION_PIN_FORM_DESCRIPTION,
                    user_id,
                    error_messages: {
                        question_1: 'Security questions not set for your account.',
                    },
                    initial_values: {
                        ...data,
                    },
                    all_questions_list,
                } satisfies ScreenDataPayload[ResetTransactionPinFlowScreens.ANSWER_SECURITY_QUESTIONS],
            };
        }

        const normalizedSecurityQuestionAnswers = Object.keys(all_questions_list)
            .map((questionInputName) => {
                const question = all_questions_list[questionInputName as QuestionKey];

                return {
                    questionId: question.id,
                    providedAnswer: data[questionInputName as QuestionKey] ?? '',
                    flowInputName: questionInputName as QuestionKey,
                } as const;
            })
            .filter((answer) => answer.questionId !== '');

        const scoreSheet = UserService.scoreUserSecurityQuestionsAnswers(
            user,
            normalizedSecurityQuestionAnswers
        );

        const failedQuestionErrorMessages: Record<QuestionKey, string> = {};
        normalizedSecurityQuestionAnswers.forEach((answer) => {
            if (!scoreSheet[answer.questionId]) {
                failedQuestionErrorMessages[answer.flowInputName] = `Incorrect answer.`;
            }
        });
        const passedQuestionsCount = Object.values(scoreSheet).filter(Boolean).length;

        if (passedQuestionsCount < 2) {
            const questionsWithErrors = Object.keys(failedQuestionErrorMessages)
                .map((key) => `❌ ${all_questions_list[key as QuestionKey].title}`)
                .join('\n');
            const errorSummary = `The answers provided for the following questions are incorrect:\n${questionsWithErrors}`;

            return {
                screen: ResetTransactionPinFlowScreens.ANSWER_SECURITY_QUESTIONS,
                data: {
                    form_description: RESET_TRANSACTION_PIN_FORM_DESCRIPTION,
                    user_id,
                    error_messages: failedQuestionErrorMessages,
                    initial_values: {
                        ...data,
                    },
                    all_questions_list,
                    error_summary: errorSummary,
                } satisfies ScreenDataPayload['ANSWER_SECURITY_QUESTIONS'],
            };
        }

        return {
            screen: ResetTransactionPinFlowScreens.NEW_PIN,
            data: {
                form_description: NEW_TRANSACTION_PIN_FORM_DESCRIPTION,
                user_id,
            } satisfies ScreenDataPayload['NEW_PIN'],
        };
    }

    private static async completeResetTransactionPinFlow(data: DataExchangePayload['NEW_PIN']) {
        const { new_pin, confirm_new_pin, user_id } = data;

        // Check 1: If transaction pin matches the allowed schema
        if (!transactionPinSchema.safeParse(new_pin).success) {
            return {
                screen: ResetTransactionPinFlowScreens.NEW_PIN,
                data: {
                    error_messages: {
                        new_pin: 'Transaction PIN should be 4 - 6 digits',
                    },
                    form_description: NEW_TRANSACTION_PIN_FORM_DESCRIPTION,
                    initial_values: {
                        ...data,
                    },
                    user_id,
                } satisfies ScreenDataPayload[ResetTransactionPinFlowScreens.NEW_PIN],
            };
        }

        // Check 2: If new pin and confirm new pin do not match
        if (new_pin !== confirm_new_pin) {
            return {
                screen: ResetTransactionPinFlowScreens.NEW_PIN,
                data: {
                    form_description: NEW_TRANSACTION_PIN_FORM_DESCRIPTION,
                    user_id,
                    error_messages: {
                        confirm_new_pin: 'New PINs do not match.',
                    },
                    initial_values: {
                        ...data,
                    },
                } satisfies ScreenDataPayload[ResetTransactionPinFlowScreens.NEW_PIN],
            };
        }

        const hashedPin = await hashString(new_pin);

        // Update the transaction pin in the background
        await queues.userTxPinSecurity.add('change-tx-pin', {
            newPinHash: hashedPin,
            userId: user_id,
        });

        // Update user's transaction pin in background
        // spawnInBackground<ChangeTransactionPinParams>(
        //     {
        //         newPinHash: hashedPin,
        //         userId: user_id,
        //     },
        //     CHANGE_TRANSACTION_PIN_SCRIPT_PATH
        // );

        return {
            screen: ResetTransactionPinFlowScreens.FEEDBACK,
            data: {
                feedback_title: 'Transaction PIN reset request sent successfully',
                feedback_message:
                    'The request to reset your Transaction PIN has been sent successfully. You will receive a confirmation message once the reset is complete.',
                feedback_sub_message:
                    'Click on the button below to return to continue using the bot.',
                footer_cta_text: 'Done',
                icon_src: SUCCESS_FEEDBACK_ICON,
            } satisfies ScreenDataPayload[ResetTransactionPinFlowScreens.FEEDBACK],
        };
    }
}

export default WhatsAppBotResetTransactionPinFlowService;
