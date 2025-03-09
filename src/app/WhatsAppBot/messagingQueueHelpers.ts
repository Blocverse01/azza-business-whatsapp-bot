import { createOrUpdateUserAgentThread, getUserAgentThread } from '@/app/aiAgent/agent.helpers';
import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import {
    ACKNOWLEDGE_BUTTON_ID_PREFIX,
    MARK_AS_PAID_BUTTON_ID_PREFIX,
} from '@/app/FiatRamp/alternatives/config';
import ManualOfframpSettlementService from '@/app/FiatRamp/alternatives/ManualOfframpSettlementService';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
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
    IncomingWhatsappMessage,
    MORE_BENEFICIARIES_COMMAND_REGEX_PATTERN,
    MORE_CURRENCIES_COMMAND_REGEX_PATTERN,
    type MoreCurrenciesCommandMatch,
    RATES_COMMAND,
    WhatsAppMessageType,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { queues } from '@/background-processing/queues';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import {
    QueueNames,
    WhatsAppBotMessagingQueueInput,
    WhatsAppBotMessagingQueueResult,
    WhatsappBroadcastQueueInput,
} from '@/background-processing/types';
import {
    extractGroups,
    extractSellAssetDestinationChoiceGroups,
    extractSellAssetToBeneficiaryGroups,
    extractTradeAssetGroups,
} from '@/constants/regex';
import { BAD_REQUEST } from '@/constants/status-codes';
import { MAINTAINANCE_MESSAGE } from '@/constants/strings';
import { HttpException } from '@/resources/exceptions/HttpException';
import { convertAsciiStringToBase64 } from '@/resources/utils/encryption';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { Worker } from 'bullmq';
import type { CountryCode } from 'libphonenumber-js';

export const receiveIncomingWhatsappMessage = async (
    message: IncomingWhatsappMessage,
    businessPhoneNumberId: string,
    displayName: string
) => {
    await queues.whatsappBotMessaging.add(
        'handle incoming whatsapp message',
        {
            message,
            businessPhoneNumberId,
            displayName,
        },
        {
            removeOnComplete: true,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 }, // Retry with a delay
        }
    );
};

const handleIncomingWhatsappMessage = async (
    message: IncomingWhatsappMessage,
    businessPhoneNumberId: string,
    displayName: string
): Promise<string> => {
    const { type, from, text, interactive } = message;

    const coreMaintainanceIsEnabled = await FeatureFlagService.isFeatureEnabled(
        FeatureFlagKey.CORE_MAINTAINANCE
    );

    const phoneParams = { userPhoneNumber: from, businessPhoneNumberId };

    if (coreMaintainanceIsEnabled) {
        await WhatsAppBotService.sendWhatsappMessage(
            businessPhoneNumberId,
            MessageGenerators.generateTextMessage(from, MAINTAINANCE_MESSAGE)
        );

        return ActionExecuted.SEND_MAINTAINANCE_MESSAGE;
    }

    const [messageThread, userV2] = await Promise.all([
        getUserAgentThread(from),
        userServiceV2.getWhatsappUserByPhoneNumber(from),
    ]);

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
                await WhatsAppBotService.sendSetTransactionPinMessage(createdNewUser, phoneParams);

                return ActionExecuted.CREATED_NEW_USER;
            }

            throw new Error('Failed to create new user');
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
        const normalizedPrompt = text.body.startsWith('/') ? text.body.replace('/', '') : text.body;

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
                    await WhatsAppBotService.walletDetailsMessage(phoneParams, userAssetBalance);
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

                case 'mark-manual-offramp-settlement-as-paid':
                    const sequenceIdToUse = interactiveButtonId.split(
                        MARK_AS_PAID_BUTTON_ID_PREFIX
                    )[1];

                    await ManualOfframpSettlementService.markManualSettlementAsPaid({
                        businessPhoneNumberId: phoneParams.businessPhoneNumberId,
                        settledBy: phoneParams.userPhoneNumber,
                        sequenceId: sequenceIdToUse,
                    });

                    return ActionExecuted.MARK_MANUAL_OFFRAMP_SETTLEMENT_PAID;

                case 'acknowledge-manual-offramp-settlement':
                    const sequenceId = interactiveButtonId.split(ACKNOWLEDGE_BUTTON_ID_PREFIX)[1];

                    await ManualOfframpSettlementService.acknowledgeManualSettlement({
                        sequenceId,
                        businessPhoneNumberId,
                        acknowledger: phoneParams.userPhoneNumber,
                    });

                    return ActionExecuted.ACKNOWLEDGED_MANUAL_OFFRAMP_SETTLEMENT;
            }
        }

        // =========== HANDLE INTERACTIVE LIST REPLIES =========== //
        if (interactive.type === 'list_reply' && interactive.list_reply) {
            const { list_reply } = interactive;

            const interactiveListId = list_reply.id;

            const interactiveActionResponse =
                WhatsAppBotService.determineInteractiveListReplyAction(interactiveListId);

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
                    await WhatsAppBotService.walletDetailsMessage(phoneParams, userAssetBalance);
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
                        await WhatsAppBotService.handleBuyAssetAction(userV2, phoneParams, assetId);

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

            const responseAction = WhatsAppBotService.determineInteractiveNfmReplyAction(nfm_reply);

            if (responseAction?.action === 'trigger-offramp-flow') {
                await WhatsAppBotService.beginOffRampFlowMessage(userV2, phoneParams, {
                    assetId: responseAction.data.assetId,
                    beneficiaryId: responseAction.data.beneficiaryId,
                });

                return ActionExecuted.SEND_OFFRAMP_FLOW_MESSAGE;
            }
        }
    }

    return ActionExecuted.NO_ACTION;
};

export const createWhatsappMessagingWorker = () => {
    return new Worker<WhatsAppBotMessagingQueueInput, WhatsAppBotMessagingQueueResult>(
        QueueNames.whatsappBotMessaging,
        async (job) => {
            const { message, businessPhoneNumberId, displayName } = job.data;

            const actionExecuted = await handleIncomingWhatsappMessage(
                message,
                businessPhoneNumberId,
                displayName
            );

            return { actionExecuted };
        },
        { connection: connectionConfig, concurrency: 100 }
    );
};

export const createWhatsappBroadcastWorker = () => {
    return new Worker<WhatsappBroadcastQueueInput>(
        QueueNames.whatsappBroadcast,
        async (job) => {
            const { businessPhoneNumberId, message } = job.data;

            await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, message);

            return { status: 'success' };
        },
        {
            connection: connectionConfig,
            concurrency: 50,
            limiter: {
                max: 20,
                duration: 1000,
            },
        }
    );
};

export const sendWhatsappBroadcastMessage = async (params: WhatsappBroadcastQueueInput) => {
    await queues.whatsappBroadcast.add('Send broadcast message', params, {
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }, // Retry with a delay
    });
};
