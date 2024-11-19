import UserService from '@/app/User/UserService';
import { FlowConfig, getFlowConfig, PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { logSync } from '@/resources/logger';
import { convertBase64ToAsciiString, generateRandomHexString } from '@/resources/utils/encryption';
import { SIXTEEN } from '@/constants/numbers';
import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import { spawnInBackground } from '@/app/azza/backgroundSpawns/spawn-in-background';
import { TRANSFER_TRANSACTION_SCRIPT_PATH } from '@/app/azza/backgroundSpawns/script-paths';
import { compareHashedString } from '@/resources/utils/hashing';

enum TransactionConfirmationFlowScreens {
    ENTER_TRANSACTION_PIN = 'ENTER_TRANSACTION_PIN',
    SUCCESS_FEEDBACK = 'SUCCESS_FEEDBACK',
    ERROR_FEEDBACK = 'ERROR_FEEDBACK',
}

type TransactionDetails = TransferAssetTransactionDetails;

type ScreenDataPayload = {
    ENTER_TRANSACTION_PIN: {
        transaction_summary: string;
        error_messages?: {
            transaction_pin?: string;
        };
        transaction_details: TransactionDetails;
    };
    SUCCESS_FEEDBACK: {
        message: string;
    };
    ERROR_FEEDBACK: {
        message: string;
    };
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

            logSync('debug', 'Next screen data', nextScreenData);

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
        const user = await UserService.getUserByPhoneNumber(unmaskedUserId);

        if (!user?.transactionPinHash) {
            return {
                screen: TransactionConfirmationFlowScreens.ERROR_FEEDBACK,
                data: {
                    message: 'Transaction pin not set',
                } satisfies ScreenDataPayload['ERROR_FEEDBACK'],
            };
        }

        const pinIsValid = await compareHashedString(transaction_pin, user.transactionPinHash!);

        if (!pinIsValid) {
            return {
                screen: TransactionConfirmationFlowScreens.ENTER_TRANSACTION_PIN,
                data: {
                    error_messages: {
                        transaction_pin: 'Invalid transaction pin',
                    },
                    transaction_summary,
                    transaction_details,
                } satisfies ScreenDataPayload['ENTER_TRANSACTION_PIN'],
            };
        }

        switch (transaction_details.transactionType) {
            case 'SEND':
                spawnInBackground(
                    {
                        ...transaction_details,
                        userId: convertBase64ToAsciiString(transaction_details.userId),
                        transactionPin: transaction_pin,
                    },
                    TRANSFER_TRANSACTION_SCRIPT_PATH
                );
                break;
        }

        return {
            screen: TransactionConfirmationFlowScreens.SUCCESS_FEEDBACK,
            data: {
                message:
                    'Transaction confirmed successfully. We will notify you once the transaction is completed.',
            },
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
