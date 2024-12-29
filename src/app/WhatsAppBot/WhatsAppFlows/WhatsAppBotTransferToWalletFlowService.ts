import {
    DataExchangeResponse,
    DecryptedFlowDataExchange,
    WhatsAppInteractiveMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { ERROR_FEEDBACK_ICON, SUCCESS_FEEDBACK_ICON } from '@/constants/feeback-icons';
import { logSync } from '@/resources/logger';
import WalletAssetManagementService from '@/app/WalletAssetManagement/WalletAssetManagementService';
import { SIXTEEN, TWO, ZERO } from '@/constants/numbers';
import { decimalToString, fixNumber } from '@/resources/utils/currency';
import { generateRandomHexString } from '@/resources/utils/encryption';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import UserService from '@/app/User/UserService';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import { AzzaUserRecord, UserAssetInfo } from '@/app/User/userSchema';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { FeedbackScreenPayload, type FlowMode } from '@/app/WhatsAppBot/WhatsAppFlows/types';
import { compareHashedString } from '@/resources/utils/hashing';
import { validateWalletAddress } from '@/resources/utils/validators';
import { getFlowConfig } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import { WaitForTransactionReceiptInBackgroundParams } from '@/app/azza/backgroundSpawns/wait-for-transaction-receipt';
import { cleanPhoneNumberInput } from '@/resources/utils/phone-numbers';
import { spawnInBackground } from '@/app/azza/backgroundSpawns/spawn-in-background';
import { WAIT_FOR_TRANSACTION_RECEIPT_SCRIPT_PATH } from '@/app/azza/backgroundSpawns/script-paths';

enum TransferToWalletFlowScreens {
    TRANSACTION_DETAILS = 'TRANSACTION_DETAILS',
    TRANSACTION_SUMMARY = 'TRANSACTION_SUMMARY',
    FEEDBACK = 'FEEDBACK',
}
type TransferRecipientType = 'azza-phone-number' | 'wallet-address';

type ScreenDataPayload = {
    TRANSACTION_DETAILS: {
        dynamic_page_title: string;
        asset_label: string;
        asset_id: string;
        user_id: string;
        user_balance: string;
        form_sub_text: string;
        init_values?: {
            wallet_address: string;
            amount: string;
            azza_phone_number: string;
        };
        error_messages?: {
            wallet_address?: string;
            amount?: string;
            azza_phone_number?: string;
        };
    };
    TRANSACTION_SUMMARY: {
        amount: string;
        asset_id: string;
        user_id: string;
        wallet_address: string;
        azza_phone_number: string;
        recipient_type: TransferRecipientType;
        asset_label: string;
        transaction_fee: string;
        transaction_pin?: string;
        error_messages?: {
            transaction_pin?: string;
        };
        init_values?: {
            transaction_pin?: string;
        };
    };
    FEEDBACK: FeedbackScreenPayload;
};
type DataExchangePayload = {
    TRANSACTION_DETAILS: {
        amount: string;
        asset_id: string;
        user_id: string;
        wallet_address: string;
        user_balance: string;
        azza_phone_number: string;
    };
    TRANSACTION_SUMMARY: {
        amount: string;
        asset_id: string;
        user_id: string;
        wallet_address: string;
        azza_phone_number: string;
        recipient_type: TransferRecipientType;
        transaction_fee: string;
        transaction_pin: string;
    };
};

const flowConfig = getFlowConfig('TRANSFER', env.WA_PHONE_NUMBER_ID);

const TRANSFER_DETAILS_FORM_SUB_TEXT =
    'Enter a wallet address OR a phone number to send crypto to.';

class WhatsAppBotTransferToWalletFlowService {
    private static FLOW_MODE: FlowMode = flowConfig.flowMode;
    private static FLOW_ID = flowConfig.flowId;
    private static INITIAL_SCREEN = TransferToWalletFlowScreens.TRANSACTION_DETAILS;
    private static readonly USER_BALANCE_PATTERN = /Your balance: (\d+) (\w+)/;

    public static async receiveDataExchange(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ): Promise<DataExchangeResponse> {
        const { action, screen, data } = requestBody;

        if (action === 'INIT') {
            // Using Preview data because initialization should typically be done from `WhatsAppBotService.handleWithdrawAssetAction`
            return this.previewInitializationFlow(requestBody);
        }

        if (action === 'data_exchange') {
            let nextScreenData: Omit<DataExchangeResponse, 'version'> | undefined;

            switch (screen) {
                case TransferToWalletFlowScreens.TRANSACTION_DETAILS:
                    nextScreenData = await this.getTransactionSummaryScreenData(
                        data as DataExchangePayload['TRANSACTION_DETAILS']
                    );
                    break;

                case TransferToWalletFlowScreens.TRANSACTION_SUMMARY:
                    nextScreenData = await this.getFeedbackScreenData(
                        data as DataExchangePayload['TRANSACTION_SUMMARY']
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

    private static async getTransactionSummaryScreenData(
        data: DataExchangePayload['TRANSACTION_DETAILS']
    ) {
        const asset = getAssetConfigOrThrow(data.asset_id);

        const transactionFee =
            WalletAssetManagementService.calculateStableTokenTransferTransactionFee(
                data.amount,
                asset.network
            );

        const assetLabel = `${asset.tokenName} (${asset.network})`;

        const userBalanceMatch = data.user_balance.match(this.USER_BALANCE_PATTERN);
        logSync('debug', 'User balance match', { userBalanceMatch });

        const userBalance = userBalanceMatch
            ? parseFloat(userBalanceMatch[1])
            : (await UserService.getUserAssetInfo(data.user_id, data.asset_id)).tokenBalance;
        const amount = parseFloat(data.amount);

        let azzaUserRecipient: AzzaUserRecord | null = null;
        const errorMessages: ScreenDataPayload['TRANSACTION_DETAILS']['error_messages'] = {};

        if (!data.wallet_address?.trim() && !data.azza_phone_number?.trim()) {
            errorMessages.wallet_address = 'Please provide a wallet address or Azza phone number';
        }

        if (data.wallet_address?.trim() && data.azza_phone_number?.trim()) {
            // Only set an error for the second field
            errorMessages.azza_phone_number = 'Please provide only one recipient type';
        }

        const recipientType: TransferRecipientType | null =
            data.wallet_address?.trim().length > 0
                ? 'wallet-address'
                : data.azza_phone_number?.trim().length > 0
                  ? 'azza-phone-number'
                  : null;

        if (amount <= ZERO) {
            errorMessages.amount = 'Amount must be greater than 0';
        }
        if (userBalance < amount) {
            errorMessages.amount = `Insufficient balance, you have only ${userBalance} ${asset.tokenName}`;
        }
        if (!recipientType) {
            errorMessages.wallet_address = 'Please provide a wallet address or Azza phone number';
        }

        if (recipientType === 'wallet-address') {
            if (!validateWalletAddress(data.wallet_address, asset.network)) {
                errorMessages.wallet_address = 'Invalid wallet address';
            }
        } else if (recipientType === 'azza-phone-number') {
            const cleanPhoneInput = cleanPhoneNumberInput(data.azza_phone_number);
            azzaUserRecipient = await UserService.searchUserByPhoneNumber(cleanPhoneInput);

            if (!azzaUserRecipient) {
                errorMessages.azza_phone_number = 'User does not exist on Azza';
            }
        }

        if (Object.keys(errorMessages).length > 0) {
            return {
                screen: TransferToWalletFlowScreens.TRANSACTION_DETAILS,
                data: {
                    error_messages: errorMessages,
                    asset_id: data.asset_id,
                    dynamic_page_title: `Withdraw ${assetLabel}`,
                    asset_label: assetLabel,
                    user_id: data.user_id,
                    user_balance: data.user_balance,
                    init_values: {
                        wallet_address: data.wallet_address,
                        amount: data.amount,
                        azza_phone_number: azzaUserRecipient?.phoneNumber ?? data.azza_phone_number,
                    },
                    form_sub_text: TRANSFER_DETAILS_FORM_SUB_TEXT,
                } satisfies ScreenDataPayload['TRANSACTION_DETAILS'],
            };
        }

        if (!recipientType) {
            throw new Error('Recipient type is missing');
        }

        return {
            screen: TransferToWalletFlowScreens.TRANSACTION_SUMMARY,
            data: {
                ...data,
                transaction_fee: decimalToString(transactionFee),
                asset_label: `${asset.tokenName} (${asset.network})`,
                recipient_type: recipientType,
            } satisfies ScreenDataPayload['TRANSACTION_SUMMARY'],
        };
    }

    private static async getFeedbackScreenData(data: DataExchangePayload['TRANSACTION_SUMMARY']) {
        const [walletInfo, user] = await Promise.all([
            UserService.getUserAssetInfo(data.user_id, data.asset_id),
            UserService.getUserByPhoneNumber(data.user_id),
        ]);

        const assetBalance = walletInfo.tokenBalance;

        const transactionFee = parseFloat(data.transaction_fee);
        const amount = parseFloat(data.amount);
        const totalAmount = WalletAssetManagementService.SHOULD_CHARGE_TRANSACTION_FEE
            ? fixNumber(amount + transactionFee, TWO)
            : amount;

        let azzaUserRecipient: AzzaUserRecord | null = null;

        if (
            data.recipient_type === 'wallet-address' &&
            !validateWalletAddress(data.wallet_address, walletInfo.assetNetwork)
        ) {
            return {
                screen: TransferToWalletFlowScreens.FEEDBACK,
                data: {
                    feedback_title: 'An error occurred',
                    feedback_message: 'Invalid wallet address',
                    feedback_sub_message: 'Confirm the wallet address and try again',
                    footer_cta_text: 'Try again',
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['FEEDBACK'],
            };
        }

        if (data.recipient_type === 'azza-phone-number') {
            const cleanPhoneInput = cleanPhoneNumberInput(data.azza_phone_number);
            azzaUserRecipient = await UserService.searchUserByPhoneNumber(cleanPhoneInput);

            if (!azzaUserRecipient?.phoneNumber) {
                return {
                    screen: TransferToWalletFlowScreens.FEEDBACK,
                    data: {
                        feedback_title: 'An error occurred',
                        feedback_message: 'User does not exist on Azza',
                        feedback_sub_message: 'Confirm the phone number and try again',
                        footer_cta_text: 'Try again',
                        icon_src: ERROR_FEEDBACK_ICON,
                    } satisfies ScreenDataPayload['FEEDBACK'],
                };
            }
        }

        if (assetBalance < totalAmount) {
            const insufficientBalanceMessage = `You're trying to pay: ${totalAmount} ${walletInfo.assetName}\nYou have only: ${assetBalance} ${walletInfo.assetName}`;

            return {
                screen: TransferToWalletFlowScreens.FEEDBACK,
                data: {
                    feedback_title: 'An error occurred',
                    feedback_message: insufficientBalanceMessage,
                    feedback_sub_message: 'Top up your balance and try again',
                    footer_cta_text: 'Try again',
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['FEEDBACK'],
            };
        }

        if (!user?.transactionPinHash) {
            return {
                screen: TransferToWalletFlowScreens.FEEDBACK,
                data: {
                    feedback_title: 'An error occurred',
                    feedback_message: 'Transaction pin not set',
                    feedback_sub_message: 'Set your transaction pin and try again',
                    footer_cta_text: 'Try again',
                    icon_src: ERROR_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['FEEDBACK'],
            };
        }

        const pinIsValid = await compareHashedString(
            data.transaction_pin,
            user.transactionPinHash!
        );
        if (!pinIsValid) {
            return {
                screen: TransferToWalletFlowScreens.TRANSACTION_SUMMARY,
                data: {
                    amount: data.amount,
                    asset_id: data.asset_id,
                    user_id: data.user_id,
                    wallet_address: data.wallet_address,
                    azza_phone_number: data.azza_phone_number,
                    recipient_type: data.recipient_type,
                    asset_label: `${walletInfo.assetName} (${walletInfo.assetNetwork})`,
                    transaction_fee: data.transaction_fee,
                    transaction_pin: data.transaction_pin,
                    error_messages: {
                        transaction_pin: 'Incorrect transaction pin',
                    },
                    init_values: {
                        transaction_pin: data.transaction_pin,
                    },
                } satisfies ScreenDataPayload['TRANSACTION_SUMMARY'],
            };
        }

        try {
            let walletAddress = data.wallet_address;

            if (
                data.recipient_type === 'azza-phone-number' &&
                azzaUserRecipient &&
                azzaUserRecipient.phoneNumber
            ) {
                walletAddress = (
                    await UserService.getUserAssetWalletOrThrow(
                        azzaUserRecipient.phoneNumber,
                        data.asset_id
                    )
                ).walletAddress;
            }

            if (!validateWalletAddress(walletAddress, walletInfo.assetNetwork)) {
                return {
                    screen: TransferToWalletFlowScreens.FEEDBACK,
                    data: {
                        feedback_title: 'An error occurred',
                        feedback_message: 'Invalid wallet address',
                        feedback_sub_message: 'Confirm the wallet address and try again',
                        footer_cta_text: 'Try again',
                        icon_src: ERROR_FEEDBACK_ICON,
                    } satisfies ScreenDataPayload['FEEDBACK'],
                };
            }

            const transactionResponse =
                await WalletAssetManagementService.transferUserAssetToWallet(
                    walletInfo,
                    walletAddress,
                    data.amount
                );

            if (transactionResponse.status === 'failed') {
                return {
                    screen: TransferToWalletFlowScreens.FEEDBACK,
                    data: {
                        feedback_title: 'An error occurred',
                        feedback_message: 'Submitting transaction failed.',
                        feedback_sub_message: 'Click on the button below to exit the flow',
                        footer_cta_text: 'Exit',
                        icon_src: ERROR_FEEDBACK_ICON,
                    } satisfies ScreenDataPayload['FEEDBACK'],
                };
            }

            const assetLabel = `${walletInfo.assetName} (${walletInfo.assetNetwork})`;

            const message = MessageGenerators.generateTextMessage(
                data.user_id,
                `⏳ Your transaction with the following details is being processed:\n\n🔀 Transfer ${amount} ${assetLabel} to ${walletAddress}\n\n➡️ Request ID: ${transactionResponse.transactionId}`
            );

            await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

            this.waitForTransactionReceiptInBackground({
                transactionId: transactionResponse.transactionId,
                userId: data.user_id,
                destination: walletAddress,
                amount: data.amount,
                assetLabel,
                network: walletInfo.assetNetwork,
            });

            return {
                screen: TransferToWalletFlowScreens.FEEDBACK,
                data: {
                    feedback_title: 'Transaction Submitted',
                    feedback_message:
                        "Your transaction is currently being processed, we'll send updates on the status of your transaction in your DM",
                    feedback_sub_message: 'Click on the button below to continue using the bot.',
                    footer_cta_text: 'Done',
                    icon_src: SUCCESS_FEEDBACK_ICON,
                } satisfies ScreenDataPayload['FEEDBACK'],
            };
        } catch (error) {
            await logServiceError(
                error,
                'TransferToWalletFlowService.getFeedbackScreenData -> Asset transfer failed'
            );

            return {
                screen: TransferToWalletFlowScreens.FEEDBACK,
                data: {
                    feedback_title: 'An error occurred',
                    feedback_message: 'Submitting transaction failed, please retry',
                    feedback_sub_message: 'Click on the button below to exit the flow',
                    icon_src: ERROR_FEEDBACK_ICON,
                    footer_cta_text: 'Exit',
                } satisfies ScreenDataPayload['FEEDBACK'],
            };
        }
    }

    private static waitForTransactionReceiptInBackground(
        params: WaitForTransactionReceiptInBackgroundParams
    ) {
        spawnInBackground<WaitForTransactionReceiptInBackgroundParams>(
            params,
            WAIT_FOR_TRANSACTION_RECEIPT_SCRIPT_PATH
        );
    }

    public static generateTransferToWalletInitMessage(params: {
        recipient: string;
        asset: UserAssetInfo;
    }) {
        const { asset, recipient } = params;

        const assetLabel = `${asset.assetName} (${asset.assetNetwork})`;

        const transferMessage = `Withdraw ${assetLabel}`;

        /**
         * Updating this will require updating the regex pattern in `this.USER_BALANCE_PATTERN`
         * */
        const userBalanceMessage = `Your balance: ${asset.tokenBalance} ${asset.assetName}`;

        const flowMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'flow',
                body: {
                    text: transferMessage,
                },
                action: {
                    name: 'flow',
                    parameters: {
                        flow_message_version: '3',
                        flow_token: generateRandomHexString(SIXTEEN),
                        flow_id: this.FLOW_ID,
                        mode: this.FLOW_MODE,
                        flow_cta: 'Withdraw Asset',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: this.INITIAL_SCREEN,
                            data: {
                                dynamic_page_title: transferMessage,
                                asset_label: assetLabel,
                                asset_id: asset.listItemId,
                                user_id: recipient,
                                user_balance: userBalanceMessage,
                                form_sub_text: TRANSFER_DETAILS_FORM_SUB_TEXT,
                            } satisfies ScreenDataPayload['TRANSACTION_DETAILS'],
                        },
                    },
                },
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipient,
        };

        return flowMessage;
    }

    public static previewInitializationFlow(
        requestBody: DecryptedFlowDataExchange['decryptedBody']
    ) {
        const data = {
            dynamic_page_title: 'Transfer USDT (Polygon)',
            asset_label: 'USDT (Polygon)',
            asset_id: 'usdt-polygon',
            user_id: '1234567890',
        };

        return {
            screen: TransferToWalletFlowScreens.TRANSACTION_DETAILS,
            data,
            version: requestBody.version,
        };
    }
}

export default WhatsAppBotTransferToWalletFlowService;
