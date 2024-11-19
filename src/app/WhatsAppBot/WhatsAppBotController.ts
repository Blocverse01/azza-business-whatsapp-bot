import WhatsAppBotSetupTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotSetupTransactionPinFlowService';
import { Request, Response } from 'express';
import env from '@/constants/env';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import UserService from '@/app/User/UserService';
import { logSync } from '@/resources/logger';
import { OK } from '@/constants/status-codes';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import {
    extractSellAssetDestinationChoiceGroups,
    extractSellAssetToBeneficiaryGroups,
    extractTradeAssetGroups,
} from '@/constants/regex';
import {
    ASSET_ACTION_REGEX_PATTERN,
    AssetActionRegexMatch,
    ExploreAssetActions,
    MORE_CURRENCIES_COMMAND_REGEX_PATTERN,
    MoreCurrenciesCommandMatch,
    RATES_COMMAND,
    WhatsAppMessageType,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { requestDecryptedDataFlowExchange } from '@/resources/requestHelpers/requestPropsGuard';
import WhatsAppBotOffRampFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotOffRampFlowService';
import { CountryCode } from 'libphonenumber-js';
import WhatsAppBotAddBeneficiaryFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotAddBeneficiaryFlowService';
import WhatsAppBotTransferToWalletFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransferToWalletFlowService';
import WhatsAppBotOnRampFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotOnRampFlowService';
import BotCommandHandler from '@/app/WhatsAppBot/BotCommandHandler';
import { getUserAgentThread } from '@/app/aiAgent/agent.helpers';
import { handleUserPrompt } from '@/app/aiAgent/agent.prompter';
import { getUserCountryCodeFromPhoneNumberOrThrow } from '@/resources/utils/currency';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotTransactionConfirmationFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransactionConfirmationFlowService';

export type Message = {
    id: string;
    type: string;
    from: string;
    text: {
        body: string;
    };
    interactive: {
        type: 'button_reply' | 'list_reply' | 'nfm_reply';
        list_reply?: {
            id: string;
            title: string;
            description: string;
        };
        button_reply?: {
            id: string;
            title: string;
        };
        nfm_reply?: {
            name: 'flow';
            response_json: string;
        };
    };
};

interface WebhookRequestBody {
    entry: [
        {
            changes: [
                {
                    value: {
                        metadata: {
                            phone_number_id: string;
                        };
                        messages: [Message];
                        contacts: [
                            {
                                profile: {
                                    name: string;
                                };
                            },
                        ];
                    };
                },
            ];
        },
    ];
}

class WhatsAppBotController {
    public static async receiveMessageWebhook(req: Request, res: Response) {
        try {
            res.sendStatus(OK);
            logSync('debug', 'Original Body Received', {
                webhookBody: req.body,
            });

            const messageParts = WhatsAppBotController.extractStringMessageParts(req.body);

            const { message, displayName, businessPhoneNumberId } = messageParts;

            if (message?.id) {
                await WhatsAppBotService.markMassageAsRead(businessPhoneNumberId, message.id);
            }

            logSync('debug', 'Extracted message parts', {
                messageParts,
            });

            if (message && message.id && businessPhoneNumberId && displayName) {
                await WhatsAppBotController.messageTypeCheck(
                    message,
                    businessPhoneNumberId,
                    displayName
                );
            } else {
                logSync('debug', 'Message object not found');
            }
        } catch (error) {
            handleRequestError(error, res, true);
        }
    }

    private static extractStringMessageParts(requestBody: WebhookRequestBody) {
        const firstEntry = requestBody.entry![0] ?? undefined;

        const firstChange = firstEntry?.changes![0];

        const firstChangeValue = firstChange?.value;

        if (!firstChangeValue) {
            logSync('info', 'Un-extracted request body', requestBody);

            return {};
        }

        if (!firstChangeValue.metadata || !firstChangeValue.metadata.phone_number_id) {
            logSync('info', 'No phone number id found in request body', {
                firstChangeValue,
            });

            return {};
        }

        const businessPhoneNumberId = firstChangeValue.metadata.phone_number_id;

        if (!firstChangeValue.messages) {
            logSync('info', 'No messages found in request body', {
                firstChangeValue,
            });

            return {};
        }

        const message = firstChangeValue.messages[0];

        const displayName = firstChangeValue.contacts[0].profile.name;

        return { businessPhoneNumberId, message, displayName };
    }

    public static async messageWebHookVerification(req: Request, res: Response) {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        // check the mode and token sent are correct
        if (mode === 'subscribe' && token === env.WEBHOOK_VERIFY_TOKEN) {
            // respond with 200 OK and challenge token from the request
            res.status(200).send(challenge);
            logSync('info', 'Webhook verified successfully!');
        } else {
            // respond with '403 Forbidden' if verify tokens do not match
            res.sendStatus(403);
        }
    }

    public static async messageTypeCheck(
        message: Message,
        businessPhoneNumberId: string,
        displayName: string
    ) {
        const { type, from, text, interactive } = message;

        logSync('debug', `message data type: ${typeof message}`, {
            message,
        });

        const phoneParams = { userPhoneNumber: from, businessPhoneNumberId };

        // ============== HANDLE TEXT MESSAGES ============== //
        if (type === WhatsAppMessageType.TEXT) {
            const botCommand = BotCommandHandler.isCommand(text.body);

            // Handle bot commands
            if (botCommand) {
                const response = await BotCommandHandler.handlePossibleCommand(
                    text.body.toLowerCase(),
                    phoneParams,
                    displayName
                );

                if (response.handled) {
                    return;
                }
            }

            // Handle `rates` text message
            if (text.body.toLowerCase() === RATES_COMMAND) {
                await WhatsAppBotService.ratesCommandHandler(from, businessPhoneNumberId);
                return;
            }

            // Handle any other text message
            const [user, messages] = await Promise.all([
                UserService.getUserByPhoneNumber(from),
                getUserAgentThread(from),
            ]);

            if (user) {
                messages.push({
                    role: 'user',
                    content: text.body,
                });

                const response = await handleUserPrompt({
                    sessionId: user.id,
                    messages,
                    userProfile: {
                        displayName,
                        countryCode: getUserCountryCodeFromPhoneNumberOrThrow(
                            phoneParams.userPhoneNumber
                        ),
                    },
                });

                const responseMessage = MessageGenerators.generateTextMessage(
                    phoneParams.userPhoneNumber,
                    response
                );

                await WhatsAppBotService.sendWhatsappMessage(
                    phoneParams.businessPhoneNumberId,
                    responseMessage
                );
            } else {
                await WhatsAppBotService.createWalletMessage(
                    businessPhoneNumberId,
                    displayName,
                    from
                );
            }

            return;
        }
        // ============== END OF HANDLING TEXT MESSAGES ============== //

        // ============== HANDLE INTERACTIVE MESSAGES ============== //
        if (type === WhatsAppMessageType.INTERACTIVE && interactive) {
            logSync('debug', `message-interactive : ${JSON.stringify(interactive)}`);

            // =========== HANDLE INTERACTIVE BUTTON REPLIES =========== //
            if (interactive.type === 'button_reply' && interactive.button_reply) {
                const { button_reply } = interactive;

                const interactiveButtonId = button_reply.id;

                const interactiveActionResponse =
                    WhatsAppBotService.determineInteractiveButtonReplyAction(interactiveButtonId);

                logSync('debug', 'Interactive button reply action', {
                    interactiveActionResponse,
                    interactiveButtonId,
                });

                switch (interactiveActionResponse) {
                    case 'create-wallet':
                        const createdNewUser = await UserService.createUser(from, displayName);

                        if (createdNewUser) {
                            await WhatsAppBotService.sendSetTransactionPinMessage(phoneParams);
                        }
                        return;

                    case 'explore-asset':
                        const userAssetInfo = await UserService.getUserAssetInfo(
                            from,
                            interactiveButtonId
                        );
                        await WhatsAppBotService.walletDetailsMessage(
                            businessPhoneNumberId,
                            from,
                            userAssetInfo
                        );
                        return;

                    case 'sell-asset-destination-choice':
                        const { assetId, beneficiaryAction, countryCode } =
                            extractSellAssetDestinationChoiceGroups(interactiveButtonId);

                        if (beneficiaryAction === 'chooseExisting') {
                            const usersBeneficiaries = await FiatRampService.getBeneficiaries(
                                from,
                                countryCode as CountryCode
                            );

                            await WhatsAppBotService.listBeneficiaryMessage(
                                businessPhoneNumberId,
                                from,
                                usersBeneficiaries,
                                assetId,
                                countryCode as CountryCode
                            );
                        }

                        if (beneficiaryAction === 'addNew') {
                            await WhatsAppBotService.beginAddBeneficiaryFlowMessage({
                                businessPhoneNumberId,
                                userPhoneNumber: from,
                                assetId,
                                countryCode: countryCode as CountryCode,
                            });
                        }

                        return;
                }
            }

            // =========== HANDLE INTERACTIVE LIST REPLIES =========== //
            if (interactive.type === 'list_reply' && interactive.list_reply) {
                const { list_reply } = interactive;

                const interactiveListId = list_reply.id;

                const interactiveActionResponse =
                    WhatsAppBotService.determineInteractiveListReplyAction(interactiveListId);

                logSync('debug', 'Interactive list reply action', {
                    interactiveActionResponse,
                    interactiveListId,
                });

                switch (interactiveActionResponse) {
                    case 'trigger-offramp-flow':
                        const { sell, beneficiaryId } =
                            extractSellAssetToBeneficiaryGroups(interactiveListId);

                        await WhatsAppBotService.beginOffRampFlowMessage({
                            businessPhoneNumberId,
                            recipient: from,
                            assetId: sell,
                            beneficiaryId,
                        });
                        return;

                    case 'return-more-currencies':
                        const [
                            __interactiveListId,
                            assetActionId,
                            purchaseAssetId,
                            nextSliceFrom,
                            nextSliceTo,
                        ] = interactiveListId.match(
                            MORE_CURRENCIES_COMMAND_REGEX_PATTERN
                        ) as MoreCurrenciesCommandMatch;

                        await WhatsAppBotService.sendSelectSupportedCurrenciesMessage(
                            phoneParams,
                            assetActionId,
                            purchaseAssetId,
                            parseInt(nextSliceFrom),
                            parseInt(nextSliceTo)
                        );

                        return;

                    case 'explore-asset':
                        const userAssetInfo = await UserService.getUserAssetInfo(
                            from,
                            interactiveListId
                        );
                        await WhatsAppBotService.walletDetailsMessage(
                            businessPhoneNumberId,
                            from,
                            userAssetInfo
                        );
                        return;

                    case 'trade-asset-with-currency':
                        const {
                            assetActionId: tradeAction,
                            purchaseAssetId: assetInteractiveId,
                            currency,
                            countryCode,
                        } = extractTradeAssetGroups(interactiveListId);

                        if (tradeAction === ExploreAssetActions.SELL_ASSET) {
                            await WhatsAppBotService.offrampDestinationChoiceMessage(
                                phoneParams,
                                assetInteractiveId,
                                countryCode
                            );
                            return;
                        }

                        if (tradeAction === ExploreAssetActions.BUY_ASSET) {
                            await WhatsAppBotService.beginOnrampFlowMessage(phoneParams, {
                                assetId: assetInteractiveId,
                                currencySymbol: currency,
                                countryCode: countryCode as CountryCode,
                            });
                        }

                        return;
                    case 'explore-asset-action':
                        const [_interactiveListId, assetAction, assetId] = interactiveListId.match(
                            ASSET_ACTION_REGEX_PATTERN
                        ) as AssetActionRegexMatch;

                        if (assetAction === 'sell') {
                            await WhatsAppBotService.handleSellAssetAction(phoneParams, assetId);

                            return;
                        }

                        if (assetAction === 'buy') {
                            await WhatsAppBotService.handleBuyAssetAction(phoneParams, assetId);

                            return;
                        }

                        if (assetAction === 'withdraw') {
                            await WhatsAppBotService.handleWithdrawAssetAction(
                                phoneParams,
                                assetId
                            );
                        }

                        if (assetAction === 'deposit') {
                            await WhatsAppBotService.depositAssetCommandHandler(
                                from,
                                businessPhoneNumberId,
                                assetId
                            );
                        }

                        return;
                }
            }

            // =========== HANDLE NFM REPLIES =========== //
            if (interactive.type === 'nfm_reply' && interactive.nfm_reply) {
                const { nfm_reply } = interactive;

                const responseAction =
                    WhatsAppBotService.determineInteractiveNfmReplyAction(nfm_reply);

                if (responseAction.action === 'trigger-offramp-flow') {
                    await WhatsAppBotService.beginOffRampFlowMessage({
                        businessPhoneNumberId,
                        recipient: from,
                        assetId: responseAction.data.assetId,
                        beneficiaryId: responseAction.data.beneficiaryId,
                    });
                }

                return;
            }
        }
    }

    public static async offrampFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response = await WhatsAppBotOffRampFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async addBeneficiaryFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsAppBotAddBeneficiaryFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async transferToWalletFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsAppBotTransferToWalletFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async onRampFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response = await WhatsAppBotOnRampFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async transactionConfirmationFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsAppBotTransactionConfirmationFlowService.receiveDataExchange(
                    decryptedBody
                );

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }

    public static async setTransactionPinFlowDataExchange(req: Request, res: Response) {
        try {
            const { decryptedBody, initialVectorBuffer, aesKeyBuffer } =
                requestDecryptedDataFlowExchange(req);

            const response =
                await WhatsAppBotSetupTransactionPinFlowService.receiveDataExchange(decryptedBody);

            return res.send(
                WhatsAppBotService.encryptFlowResponse(response, {
                    initialVectorBuffer,
                    aesKeyBuffer,
                })
            );
        } catch (error) {
            handleRequestError(error, res);
        }
    }
}

export default WhatsAppBotController;
