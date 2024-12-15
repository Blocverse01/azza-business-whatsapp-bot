import { getUserAgentThread } from '@/app/aiAgent/agent.helpers';
import { handleUserPrompt } from '@/app/aiAgent/agent.prompter';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import UserService from '@/app/User/UserService';
import BotCommandHandler from '@/app/WhatsAppBot/BotCommandHandler';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import {
    ActionExecuted,
    ASSET_ACTION_REGEX_PATTERN,
    type AssetActionRegexMatch,
    BaseInteractiveButtonIds,
    ExploreAssetActions,
    MORE_CURRENCIES_COMMAND_REGEX_PATTERN,
    type MoreCurrenciesCommandMatch,
    RATES_COMMAND,
    WhatsAppMessageType,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { deriveUserFeatureAccessLevel } from '@/config/whatsAppBot';
import env from '@/constants/env';
import {
    extractSellAssetDestinationChoiceGroups,
    extractSellAssetToBeneficiaryGroups,
    extractTradeAssetGroups,
} from '@/constants/regex';
import { OK } from '@/constants/status-codes';
import { logSync } from '@/resources/logger';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { getUserCountryCodeFromPhoneNumberOrThrow } from '@/resources/utils/currency';
import { convertAsciiStringToBase64 } from '@/resources/utils/encryption';
import type { Request, Response } from 'express';
import { type CountryCode } from 'libphonenumber-js';

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
            const messageReceivedAt = new Date();

            res.sendStatus(OK);
            logSync('debug', 'Original Body Received', {
                webhookBody: req.body,
            });

            const messageParts = WhatsAppBotController.extractStringMessageParts(req.body);

            const { message, displayName, businessPhoneNumberId } = messageParts;

            if (message?.id) {
                void WhatsAppBotService.markMassageAsRead(businessPhoneNumberId, message.id);
            }

            logSync('debug', 'Extracted message parts', {
                messageParts,
            });

            if (message && message.id && businessPhoneNumberId && displayName) {
                const actionExecuted = await WhatsAppBotController.messageTypeCheck(
                    message,
                    businessPhoneNumberId,
                    displayName
                );

                const messageHandledAt = new Date();
                const messageHandledDuration =
                    messageHandledAt.getTime() - messageReceivedAt.getTime();

                logSync('debug', 'Message handled', {
                    timeTaken: `${messageHandledDuration}ms`,
                    actionExecuted,
                });
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
    ): Promise<string> {
        const { type, from, text, interactive } = message;

        const phoneParams = { userPhoneNumber: from, businessPhoneNumberId };

        const [user, messages] = await Promise.all([
            UserService.getUserByPhoneNumber(from),
            getUserAgentThread(from),
        ]);

        if (!user) {
            if (
                interactive &&
                interactive.button_reply?.id === BaseInteractiveButtonIds.CREATE_WALLET
            ) {
                const createdNewUser = await UserService.createUser(from, displayName);

                if (createdNewUser) {
                    await WhatsAppBotService.sendSetTransactionPinMessage(phoneParams);

                    return ActionExecuted.CREATED_NEW_USER;
                }

                return ActionExecuted.FAILED_TO_CREATE_NEW_USER;
            }

            await WhatsAppBotService.createWalletMessage(businessPhoneNumberId, displayName, from);
            return ActionExecuted.SEND_CREATE_WALLET_MESSAGE;
        }

        if (type === WhatsAppMessageType.TEXT && user && !user?.transactionPinHash) {
            await WhatsAppBotService.sendSetTransactionPinMessage(phoneParams, {
                displayName,
            });
            return ActionExecuted.SEND_SET_TRANSACTION_PIN_MESSAGE;
        }

        // ============== HANDLE TEXT MESSAGES ============== //
        if (type === WhatsAppMessageType.TEXT) {
            const botCommand = BotCommandHandler.isCommand(text.body);

            // Handle bot commands
            if (botCommand) {
                const response = await BotCommandHandler.handlePossibleCommand(
                    text.body.toLowerCase(),
                    phoneParams,
                    displayName,
                    deriveUserFeatureAccessLevel(user.FEATURE_ACCESS_LEVEL)
                );

                if (response.handled) {
                    return ActionExecuted.HANDLE_BOT_COMMAND + ': ' + botCommand.command;
                }
            }

            // Handle `rates` text message
            if (text.body.toLowerCase() === RATES_COMMAND) {
                await WhatsAppBotService.ratesCommandHandler(from, businessPhoneNumberId);
                return ActionExecuted.HANDLE_RATES_MESSAGE;
            }

            // Handle any other text message
            const normalizedPrompt = text.body.startsWith('/')
                ? text.body.replace('/', '')
                : text.body;

            const userIdMessage = {
                role: 'system',
                content: `Here's the user's system-provided ID: '${convertAsciiStringToBase64(user.id)}'. Always use this value for the 'userId' parameter in tool calls, extract it without any confirmation from the user.`,
            } as const;

            if (!messages.find((message) => message.content === userIdMessage.content)) {
                messages.push(userIdMessage);
            }

            messages.push({
                role: 'user',
                content: normalizedPrompt,
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

            return ActionExecuted.SEND_ASSISTANT_REPLY;
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

                        return ActionExecuted.CREATED_NEW_USER;

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
                        return ActionExecuted.SEND_MANAGE_ASSET_MESSAGE;

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

                        return ActionExecuted.SEND_SELL_ASSET_DESTINATION_CHOICE_MESSAGE;
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
                        return ActionExecuted.SEND_OFFRAMP_FLOW_MESSAGE;

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

                        return ActionExecuted.SEND_MORE_CURRENCIES_MESSAGE;

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
                        return ActionExecuted.SEND_MANAGE_ASSET_MESSAGE;

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
                            return ActionExecuted.SEND_TRADE_ASSET_WITH_CURRENCY_MESSAGE;
                        }

                        if (tradeAction === ExploreAssetActions.BUY_ASSET) {
                            await WhatsAppBotService.beginOnrampFlowMessage(phoneParams, {
                                assetId: assetInteractiveId,
                                currencySymbol: currency,
                                countryCode: countryCode as CountryCode,
                            });
                        }

                        throw new Error('Invalid trade action');
                    case 'explore-asset-action':
                        const [_interactiveListId, assetAction, assetId] = interactiveListId.match(
                            ASSET_ACTION_REGEX_PATTERN
                        ) as AssetActionRegexMatch;

                        if (assetAction === 'sell') {
                            await WhatsAppBotService.handleSellAssetAction(
                                phoneParams,
                                assetId,
                                deriveUserFeatureAccessLevel(user.FEATURE_ACCESS_LEVEL)
                            );

                            return ActionExecuted.SEND_SELL_ASSET_MESSAGE;
                        }

                        if (assetAction === 'buy') {
                            await WhatsAppBotService.handleBuyAssetAction(
                                phoneParams,
                                assetId,
                                deriveUserFeatureAccessLevel(user.FEATURE_ACCESS_LEVEL)
                            );

                            return ActionExecuted.SEND_BUY_ASSET_MESSAGE;
                        }

                        if (assetAction === 'withdraw') {
                            await WhatsAppBotService.handleWithdrawAssetAction(
                                phoneParams,
                                assetId
                            );

                            return ActionExecuted.SEND_WITHDRAW_ASSET_MESSAGE;
                        }

                        if (assetAction === 'deposit') {
                            await WhatsAppBotService.depositAssetCommandHandler(
                                from,
                                businessPhoneNumberId,
                                assetId
                            );

                            return ActionExecuted.SEND_DEPOSIT_ASSET_MESSAGE;
                        }

                        throw new Error('Invalid asset action');
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

                    return ActionExecuted.SEND_OFFRAMP_FLOW_MESSAGE;
                }
            }
        }

        return ActionExecuted.NO_ACTION;
    }
}

export default WhatsAppBotController;
