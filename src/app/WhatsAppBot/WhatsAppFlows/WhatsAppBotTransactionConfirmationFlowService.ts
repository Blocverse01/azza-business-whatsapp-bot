import {
    SwapTokensOnBaseTransactionDetails,
    SwapTokensTransactionDetails,
    TransferAssetTransactionDetails,
} from '@/app/azza/azza.schema';
import { sendTransferAssetTransaction } from '@/app/azza/lib/azza.lib.transaction';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { FlowConfig, getFlowConfig, PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import { FeedbackScreenPayload } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import { queues } from '@/background-processing/queues';
import env from '@/constants/env';
import { ERROR_FEEDBACK_ICON, SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { SIXTEEN } from '@/constants/numbers';
import { convertBase64ToAsciiString, generateRandomHexString } from '@/resources/utils/encryption';
import { compareHashedString } from '@/resources/utils/hashing';
import userServiceV2 from '@/runtime/user';

enum TransactionConfirmationFlowScreens {
    ENTER_TRANSACTION_PIN = 'ENTER_TRANSACTION_PIN',
    FEEDBACK = 'FEEDBACK',
}

type TransactionDetails =
    | TransferAssetTransactionDetails
    | SwapTokensOnBaseTransactionDetails
    | SwapTokensTransactionDetails;

type ScreenDataPayload = {
    ENTER_TRANSACTION_PIN: {
        transaction_summary: string;
        error_messages?: {
            transaction_pin?: string;
        };
        transaction_details: TransactionDetails;
    };
    FEEDBACK: FeedbackScreenPayload;
};
type DataExchangePayload = {
    ENTER_TRANSACTION_PIN: {
        transaction_pin: string;
        transaction_summary: string;
        transaction_details: TransactionDetails;
    };
};

class WhatsAppBotTransactionConfirmationFlowService {
    private static flowConfig: FlowConfig;
    private static INITIAL_SCREEN = TransactionConfirmationFlowScreens.ENTER_TRANSACTION_PIN;

    public static withPhoneNumberId(phoneNumberId: PhoneNumberId) {
        this.flowConfig = getFlowConfig('TRANSACTION_CONFIRMATION', phoneNumberId);
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
                case TransactionConfirmationFlowScreens.ENTER_TRANSACTION_PIN:
                    nextScreenData = await this.getFeedbackScreenData(
                        data as DataExchangePayload['ENTER_TRANSACTION_PIN']
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

    private static async getFeedbackScreenData(
        data: DataExchangePayload['ENTER_TRANSACTION_PIN']
    ): Promise<Omit<DataExchangeResponse, 'version'>> {
        const { transaction_pin, transaction_summary, transaction_details } = data;

        const unmaskedUserId = convertBase64ToAsciiString(transaction_details.userId);
        const user = await userServiceV2.getUserById(unmaskedUserId);

        if (!user?.transactionPinHash) {
            return {
                screen: TransactionConfirmationFlowScreens.FEEDBACK,
                data: {
                    feedback_title: 'An error occurred',
                    feedback_message: 'Transaction pin not set',
                    feedback_sub_message: 'Exit the flow and set your transaction pin to continue',
                    footer_cta_text: 'Exit',
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['FEEDBACK'],
            };
        }

        const pinIsValid = await compareHashedString(transaction_pin, user.transactionPinHash!);

        if (!pinIsValid) {
            return {
                screen: TransactionConfirmationFlowScreens.ENTER_TRANSACTION_PIN,
                data: {
                    error_messages: {
                        transaction_pin: 'Incorrect transaction pin',
                    },
                    transaction_summary,
                    transaction_details,
                } satisfies ScreenDataPayload['ENTER_TRANSACTION_PIN'],
            };
        }

        switch (transaction_details.transactionType) {
            case 'SEND':
                const userPhoneNumber = user.primaryWhatsappPhoneNumber;

                const [transaction, error] = await sendTransferAssetTransaction(
                    {
                        ...transaction_details,
                        userId: unmaskedUserId,
                        transactionPin: transaction_pin,
                    },
                    true,
                    'new'
                );

                if (error !== null) {
                    return {
                        screen: TransactionConfirmationFlowScreens.FEEDBACK,
                        data: {
                            feedback_title: 'An error occurred',
                            feedback_message: `Submitting transaction failed: ${error.message}`,
                            feedback_sub_message: 'Click on the button below to exit the flow',
                            footer_cta_text: 'Exit',
                            icon_src: ERROR_FEEDBACK_ICON,
                        } satisfies ScreenDataPayload['FEEDBACK'],
                    };
                }

                const assetLabel = `${transaction.asset.tokenName} (${transaction.asset.network})`;

                const message = MessageGenerators.generateTextMessage(
                    user.primaryWhatsappPhoneNumber,
                    `⏳ Your transaction with the following details is being processed:\n\n🔀 Transfer ${transaction.transactionAmount} ${assetLabel} to ${transaction.destination}\n\n➡️ Request ID: ${transaction.transactionId}`
                );

                await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

                await queues.cryptoDebitConfirmation.add('send-crypto-confirmation', {
                    transactionResponse: transaction,
                    whatsappParams: {
                        businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        userPhoneNumber: userPhoneNumber,
                    },
                });
                break;

            default:
                throw new Error('Invalid transaction type');
        }

        return {
            screen: TransactionConfirmationFlowScreens.FEEDBACK,
            data: {
                feedback_title: 'Transaction Submitted',
                footer_cta_text: 'Done',
                feedback_message:
                    'Transaction submitted successfully. We will notify you once the transaction is completed.',
                feedback_sub_message: 'Click the button below to continue using the bot.',
                icon_src: SUCCESS_FEEDBACK_ICON,
            } satisfies ScreenDataPayload['FEEDBACK'],
        };
    }

    public static createTransactionConfirmationFlowMessage(params: {
        transactionSummary: string;
        transactionMessageBody: string;
        msgRecipient: string;
        transactionDetails: TransactionDetails;
    }) {
        const { transactionSummary, transactionMessageBody, msgRecipient, transactionDetails } =
            params;

        const flowMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'flow',
                body: {
                    text: transactionMessageBody,
                },
                action: {
                    name: 'flow',
                    parameters: {
                        flow_message_version: '3',
                        flow_token: generateRandomHexString(SIXTEEN),
                        flow_id: this.flowConfig.flowId,
                        mode: this.flowConfig.flowMode,
                        flow_cta: 'Confirm Transaction',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: this.INITIAL_SCREEN,
                            data: {
                                error_messages: {
                                    transaction_pin: '',
                                },
                                transaction_summary: transactionSummary,
                                transaction_details: transactionDetails,
                            } satisfies ScreenDataPayload['ENTER_TRANSACTION_PIN'],
                        },
                    },
                },
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: msgRecipient,
        };

        return flowMessage;
    }
}

export default WhatsAppBotTransactionConfirmationFlowService;
