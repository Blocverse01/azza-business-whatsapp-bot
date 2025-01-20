import { createOrUpdateUserAgentThread, getUserAgentThread } from '@/app/aiAgent/agent.helpers';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import UserService from '@/app/User/UserService';
import BotCommandHandler from '@/app/WhatsAppBot/BotCommandHandler';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import { getSessionId, textPromptHandler } from '@/app/WhatsAppBot/text/textPromptHandler';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import {
    ActionExecuted,
    ASSET_ACTION_REGEX_PATTERN,
    type AssetActionRegexMatch,
    BaseInteractiveButtonIds,
    ExploreAssetActions,
    MORE_BENEFICIARIES_COMMAND_REGEX_PATTERN,
    MORE_CURRENCIES_COMMAND_REGEX_PATTERN,
    type MoreCurrenciesCommandMatch,
    RATES_COMMAND,
    WhatsAppMessageType,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { queues } from '@/background-processing/queues';
import env from '@/constants/env';
import {
    extractGroups,
    extractSellAssetDestinationChoiceGroups,
    extractSellAssetToBeneficiaryGroups,
    extractTradeAssetGroups,
} from '@/constants/regex';
import { BAD_REQUEST, OK } from '@/constants/status-codes';
import { HttpException } from '@/resources/exceptions/HttpException';
import { logSync } from '@/resources/logger';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { convertAsciiStringToBase64 } from '@/resources/utils/encryption';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
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

const FINISHED_MIGRATION = true;

class WhatsAppBotController {
    public static async receiveMessageWebhook(req: Request, res: Response) {
        try {
            const messageReceivedAt = new Date();

            res.sendStatus(OK);

            const messageParts = WhatsAppBotController.extractStringMessageParts(req.body);

            const { message, displayName, businessPhoneNumberId } = messageParts;

            if (message?.id) {
                void WhatsAppBotService.markMassageAsRead(businessPhoneNumberId, message.id);
            }

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
                return;
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

        const [user, messageThread, userV2] = await Promise.all([
            UserService.getUserByPhoneNumber(from),
            getUserAgentThread(from),
            userServiceV2.getWhatsappUserByPhoneNumber(from),
        ]);

        if (!FINISHED_MIGRATION) {
            await WhatsAppBotService.sendWhatsappMessage(
                businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    from,
                    `Hello ${displayName}, features are currently disabled until wallet migration is complete`
                )
            );

            return ActionExecuted.MIGRATING_USER_WALLET;
        }

        if (user && !userV2) {
            await WhatsAppBotService.sendWhatsappMessage(
                businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    from,
                    `Hello ${displayName}, we are currently migrating your wallet to a new system. Please wait a moment.\n_This process will take a few minutes_.`
                )
            );

            await queues.walletMigration.add('migrate user data and wallet', {
                oldUserId: convertAsciiStringToBase64(user.id),
                userPhoneNumber: convertAsciiStringToBase64(from),
                businessPhoneNumberId: convertAsciiStringToBase64(businessPhoneNumberId),
            });

            return ActionExecuted.MIGRATING_USER_WALLET;
        }

        if (!userV2) {
            if (
                interactive &&
                interactive.button_reply?.id === BaseInteractiveButtonIds.CREATE_WALLET
            ) {
                const createdNewUser = await userServiceV2.createWhatsappUser(from);

                await queues.walletMigration.add(`Create wallets for user: ${createdNewUser.id}`, {
                    userPhoneNumber: convertAsciiStringToBase64(from),
                    businessPhoneNumberId: convertAsciiStringToBase64(businessPhoneNumberId),
                });

                if (createdNewUser) {
                    await WhatsAppBotService.sendSetTransactionPinMessage(
                        createdNewUser,
                        phoneParams
                    );

                    return ActionExecuted.CREATED_NEW_USER;
                }

                return ActionExecuted.FAILED_TO_CREATE_NEW_USER;
            }

            await WhatsAppBotService.createWalletMessage(businessPhoneNumberId, displayName, from);
            return ActionExecuted.SEND_CREATE_WALLET_MESSAGE;
        }

        if (type === WhatsAppMessageType.TEXT && userV2 && !userV2.transactionPinHash) {
            await WhatsAppBotService.sendSetTransactionPinMessage(userV2, phoneParams, {
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
                    userV2
                );

                if (response.handled) {
                    return ActionExecuted.HANDLE_BOT_COMMAND + ': ' + botCommand.command;
                }
            }

            // Handle `rates` text message
            if (text.body.toLowerCase() === RATES_COMMAND || text.body.toLowerCase() === 'rate') {
                await WhatsAppBotService.ratesCommandHandler(from, businessPhoneNumberId);
                return ActionExecuted.HANDLE_RATES_MESSAGE;
            }

            // Handle any other text message
            const normalizedPrompt = text.body.startsWith('/')
                ? text.body.replace('/', '')
                : text.body;

            const result = await textPromptHandler({
                storedMessages: messageThread.messages,
                lastSessionId: messageThread.lastSessionId,
                prompt: normalizedPrompt,
                botParams: phoneParams,
                user: userV2,
            });

            if (result.handledTextPrompt) {
                const aiResponse = result.promptHandlerResponse.response;

                const sessionId = getSessionId(
                    phoneParams.userPhoneNumber,
                    result.classifiedAction.class
                );

                const lastSessionId = result.promptHandlerResponse.resetSession ? '' : sessionId;

                await createOrUpdateUserAgentThread({
                    ownerId: from,
                    newMessages: [
                        {
                            role: 'user',
                            content: result.prompt,
                            sessionId: sessionId,
                        },
                        {
                            role: 'assistant',
                            content: aiResponse,
                            sessionId: sessionId,
                        },
                    ],
                    lastSessionId,
                });
            }

            return result.classifiedAction.class;
        }
        // ============== END OF HANDLING TEXT MESSAGES ============== //

        // ============== HANDLE INTERACTIVE MESSAGES ============== //
        if (type === WhatsAppMessageType.INTERACTIVE && interactive) {
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
                        const createdNewUser = await userServiceV2.createWhatsappUser(from);

                        await queues.walletMigration.add(
                            `Create wallets for user: ${createdNewUser.id}`,
                            {
                                userPhoneNumber: convertAsciiStringToBase64(from),
                                businessPhoneNumberId:
                                    convertAsciiStringToBase64(businessPhoneNumberId),
                            }
                        );

                        if (createdNewUser) {
                            await WhatsAppBotService.sendSetTransactionPinMessage(
                                createdNewUser,
                                phoneParams
                            );

                            return ActionExecuted.CREATED_NEW_USER;
                        }

                        return ActionExecuted.CREATED_NEW_USER;

                    case 'explore-asset':
                        const userAssetBalance = await azzaWalletManager.getAssetBalance({
                            userId: userV2.id,
                            assetId: interactiveButtonId,
                        });
                        await WhatsAppBotService.walletDetailsMessage(
                            phoneParams,
                            userAssetBalance
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

                        await WhatsAppBotService.beginOffRampFlowMessage(userV2, phoneParams, {
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

                    case 'return-more-beneficiaries':
                        const params = extractGroups<{
                            assetId: string;
                            countryCode: string;
                            nextSliceFrom: string;
                            nextSliceTo: string;
                        }>(interactiveListId, new RegExp(MORE_BENEFICIARIES_COMMAND_REGEX_PATTERN));

                        const usersBeneficiaries = await FiatRampService.getBeneficiaries(
                            from,
                            params.countryCode as CountryCode
                        );
                        await WhatsAppBotService.listBeneficiaryMessage(
                            businessPhoneNumberId,
                            from,
                            usersBeneficiaries,
                            params.assetId,
                            params.countryCode as CountryCode,
                            parseInt(params.nextSliceFrom),
                            parseInt(params.nextSliceTo)
                        );
                        return ActionExecuted.SEND_SELL_ASSET_DESTINATION_CHOICE_MESSAGE;

                    case 'explore-asset':
                        const userAssetBalance = await azzaWalletManager.getAssetBalance({
                            userId: userV2.id,
                            assetId: interactiveListId,
                        });
                        await WhatsAppBotService.walletDetailsMessage(
                            phoneParams,
                            userAssetBalance
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
                            await WhatsAppBotService.beginOnrampFlowMessage(userV2, phoneParams, {
                                assetId: assetInteractiveId,
                                currencySymbol: currency,
                                countryCode: countryCode as CountryCode,
                            });
                            return ActionExecuted.SEND_ONRAMP_FLOW_MESSAGE;
                        }

                        throw new HttpException(BAD_REQUEST, 'Invalid trade action', {
                            tradeAction,
                        });
                    case 'explore-asset-action':
                        const [_interactiveListId, assetAction, assetId] = interactiveListId.match(
                            ASSET_ACTION_REGEX_PATTERN
                        ) as AssetActionRegexMatch;

                        if (assetAction === 'sell') {
                            await WhatsAppBotService.handleSellAssetAction(
                                userV2,
                                phoneParams,
                                assetId
                            );

                            return ActionExecuted.SEND_SELL_ASSET_MESSAGE;
                        }

                        if (assetAction === 'buy') {
                            await WhatsAppBotService.handleBuyAssetAction(
                                userV2,
                                phoneParams,
                                assetId
                            );

                            return ActionExecuted.SEND_BUY_ASSET_MESSAGE;
                        }

                        if (assetAction === 'withdraw') {
                            await WhatsAppBotService.handleWithdrawAssetAction(
                                userV2,
                                phoneParams,
                                assetId
                            );

                            return ActionExecuted.SEND_WITHDRAW_ASSET_MESSAGE;
                        }

                        if (assetAction === 'deposit') {
                            await WhatsAppBotService.depositAssetCommandHandler(
                                userV2,
                                phoneParams,
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
                    await WhatsAppBotService.beginOffRampFlowMessage(userV2, phoneParams, {
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
