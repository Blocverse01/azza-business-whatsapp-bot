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
import { BAD_REQUEST, INTERNAL_SERVER_ERROR } from '@/constants/status-codes';
import { getDynamicMaintenanceMessage } from '@/constants/strings';
import { HttpException } from '@/resources/exceptions/HttpException';
// import { convertAsciiStringToBase64 } from '@/resources/utils/encryption';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { Worker } from 'bullmq';
import type { CountryCode } from 'libphonenumber-js';
import { handleUserMessage } from './text/handleUserMessage';
import { VERIFY_ME_QUICK_REPLY_PAYLOAD } from './templates/base-cashback-reminder';
import { handleUserKycRequest } from '../kyc/utils';
import { extractReferralCodeFromMessage } from '../referral-scheme/utils';
import ReferralSchemeService from '../referral-scheme/service';

export const receiveIncomingWhatsappMessageV2 = async (
    message: IncomingWhatsappMessage,
    businessPhoneNumberId: string,
    displayName: string
) => {
    await queues.whatsappBotMessagingTemp.add(
        'handle incoming whatsapp message -- maintenance mode',
        {
            message,
            businessPhoneNumberId,
            displayName,
        },
        {
            removeOnComplete: {
                age: 2 * 3600, // keep up to 2 hours
                count: 1000, // keep up to 1000 jobs
            },
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 }, // Retry with a delay
        }
    );
};

const handleIncomingWhatsappMessageV2 = async (
    message: IncomingWhatsappMessage,
    businessPhoneNumberId: string,
    displayName: string
): Promise<string> => {
    const { type, from, text, interactive } = message;

    const phoneParams = { userPhoneNumber: from, businessPhoneNumberId };

    const [userV2, coreMaintenanceIsEnabled] = await Promise.all([
        userServiceV2.getWhatsappUserByPhoneNumber(from),
        FeatureFlagService.isFeatureEnabled(FeatureFlagKey.CORE_MAINTAINANCE),
    ]);

    if (!userV2) {
        if (interactive?.button_reply?.id.startsWith(BaseInteractiveButtonIds.CREATE_WALLET)) {
            const createdNewUser =
                (await userServiceV2.getWhatsappUserByPhoneNumber(from, {
                    omitCache: true,
                })) ?? (await userServiceV2.createWhatsappUser(from));

            // Wallet creation happens on demand when the user requests it
            // await queues.walletMigration.add(`Create wallets for user: ${createdNewUser.id}`, {
            //     userPhoneNumber: convertAsciiStringToBase64(from),
            //     businessPhoneNumberId: convertAsciiStringToBase64(businessPhoneNumberId),
            // });

            if (createdNewUser) {
                const optionalReferralCode = interactive.button_reply.id.split(':')[1] ?? undefined;
                if (optionalReferralCode) {
                    const validReferralScheme =
                        await ReferralSchemeService.getReferralSchemeByCode(optionalReferralCode);

                    if (validReferralScheme) {
                        await ReferralSchemeService.registerReferral({
                            refereeId: createdNewUser.id,
                            referralSchemeId: validReferralScheme.id,
                        });
                    }
                }

                await WhatsAppBotService.sendSetTransactionPinMessage(createdNewUser, phoneParams);

                return ActionExecuted.CREATED_NEW_USER;
            }

            throw new Error('Failed to create new user');
        }

        let referralCode: string | null = null;

        if (type === WhatsAppMessageType.TEXT) {
            const possibleReferralCode = extractReferralCodeFromMessage(text.body);
            if (possibleReferralCode) {
                const validReferralScheme =
                    await ReferralSchemeService.getReferralSchemeByCode(possibleReferralCode);
                referralCode = validReferralScheme?.isActive ? validReferralScheme.code : null;
            }
        }

        await WhatsAppBotService.createWalletMessage(
            businessPhoneNumberId,
            displayName,
            from,
            referralCode
        );
        return ActionExecuted.SEND_CREATE_WALLET_MESSAGE;
    }

    if (type === WhatsAppMessageType.TEXT && userV2 && !userV2.transactionPinHash) {
        await WhatsAppBotService.sendSetTransactionPinMessage(userV2, phoneParams, {
            displayName,
        });
        return ActionExecuted.SEND_SET_TRANSACTION_PIN_MESSAGE;
    }

    ////////////////////////////////////
    // QUICK REPLY BUTTON MESSAGES
    ////////////////////////////////////
    if (type === WhatsAppMessageType.BUTTON) {
        if (message.button?.payload === VERIFY_ME_QUICK_REPLY_PAYLOAD) {
            await handleUserKycRequest(userV2, phoneParams);

            return ActionExecuted.SEND_KYC_QUERY_RESPONSE;
        }

        throw new HttpException(INTERNAL_SERVER_ERROR, 'Unhandled button message', {
            button: message.button,
        });
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

        const result = await handleUserMessage({
            message: normalizedPrompt,
            user: userV2,
            phoneParams,
        });
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
                case 'create-wallet': {
                    const createdNewUser = await userServiceV2.createWhatsappUser(from);

                    // Wallet creation happens on demand when the user requests it
                    // await queues.walletMigration.add(
                    //     `Create wallets for user: ${createdNewUser.id}`,
                    //     {
                    //         userPhoneNumber: convertAsciiStringToBase64(from),
                    //         businessPhoneNumberId:
                    //             convertAsciiStringToBase64(businessPhoneNumberId),
                    //     }
                    // );

                    if (createdNewUser) {
                        const optionalReferralCode = interactiveButtonId.split(':')[1] ?? undefined;
                        if (optionalReferralCode) {
                            const validReferralScheme =
                                await ReferralSchemeService.getReferralSchemeByCode(
                                    optionalReferralCode
                                );

                            if (validReferralScheme) {
                                await ReferralSchemeService.registerReferral({
                                    refereeId: createdNewUser.id,
                                    referralSchemeId: validReferralScheme.id,
                                });
                            }
                        }
                        await WhatsAppBotService.sendSetTransactionPinMessage(
                            createdNewUser,
                            phoneParams
                        );

                        return ActionExecuted.CREATED_NEW_USER;
                    }

                    return ActionExecuted.CREATED_NEW_USER;
                }
                case 'explore-asset': {
                    if (coreMaintenanceIsEnabled) {
                        const maintenanceMessage = getDynamicMaintenanceMessage(
                            'asset management',
                            {
                                length: 3,
                                name: 'hours',
                            }
                        );

                        await WhatsAppBotService.sendWhatsappMessage(
                            phoneParams.businessPhoneNumberId,
                            MessageGenerators.generateTextMessage(
                                phoneParams.userPhoneNumber,
                                maintenanceMessage
                            )
                        );

                        return ActionExecuted.SEND_MAINTAINANCE_MESSAGE;
                    }

                    const userAssetBalance = await azzaWalletManager.getAssetBalance({
                        userId: userV2.id,
                        assetId: interactiveButtonId,
                    });
                    await WhatsAppBotService.walletDetailsMessage(phoneParams, userAssetBalance);
                    return ActionExecuted.SEND_MANAGE_ASSET_MESSAGE;
                }
                case 'sell-asset-destination-choice': {
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
                case 'mark-manual-offramp-settlement-as-paid': {
                    const sequenceIdToUse = interactiveButtonId.split(
                        MARK_AS_PAID_BUTTON_ID_PREFIX
                    )[1];

                    await ManualOfframpSettlementService.markManualSettlementAsPaid({
                        businessPhoneNumberId: phoneParams.businessPhoneNumberId,
                        settledBy: phoneParams.userPhoneNumber,
                        sequenceId: sequenceIdToUse,
                    });

                    return ActionExecuted.MARK_MANUAL_OFFRAMP_SETTLEMENT_PAID;
                }
                case 'acknowledge-manual-offramp-settlement': {
                    const sequenceId = interactiveButtonId.split(ACKNOWLEDGE_BUTTON_ID_PREFIX)[1];

                    await ManualOfframpSettlementService.acknowledgeManualSettlement({
                        sequenceId,
                        businessPhoneNumberId,
                        acknowledger: phoneParams.userPhoneNumber,
                    });

                    return ActionExecuted.ACKNOWLEDGED_MANUAL_OFFRAMP_SETTLEMENT;
                }
                case 'explore-asset-action': {
                    const [_interactiveButtonId, assetAction, _assetId] = interactiveButtonId.match(
                        ASSET_ACTION_REGEX_PATTERN
                    ) as AssetActionRegexMatch;

                    if (assetAction === 'deposit') {
                        if (coreMaintenanceIsEnabled) {
                            const maintenanceMessage = getDynamicMaintenanceMessage('deposit', {
                                length: 3,
                                name: 'hours',
                            });

                            await WhatsAppBotService.sendWhatsappMessage(
                                phoneParams.businessPhoneNumberId,
                                MessageGenerators.generateTextMessage(
                                    phoneParams.userPhoneNumber,
                                    maintenanceMessage
                                )
                            );

                            return ActionExecuted.SEND_MAINTAINANCE_MESSAGE;
                        }

                        await WhatsAppBotService.depositAssetCommandHandler(
                            userV2,
                            phoneParams,
                            _assetId,
                            true
                        );

                        return ActionExecuted.SEND_DEPOSIT_ASSET_MESSAGE;
                    }

                    throw new Error(`Unhandled asset action: ${assetAction}`);
                }
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
                        if (coreMaintenanceIsEnabled) {
                            const maintenanceMessage = getDynamicMaintenanceMessage('sell', {
                                length: 3,
                                name: 'hours',
                            });

                            await WhatsAppBotService.sendWhatsappMessage(
                                phoneParams.businessPhoneNumberId,
                                MessageGenerators.generateTextMessage(
                                    phoneParams.userPhoneNumber,
                                    maintenanceMessage
                                )
                            );

                            return ActionExecuted.SEND_MAINTAINANCE_MESSAGE;
                        }

                        await WhatsAppBotService.handleSellAssetAction(
                            userV2,
                            phoneParams,
                            assetId
                        );

                        return ActionExecuted.SEND_SELL_ASSET_MESSAGE;
                    }

                    if (assetAction === 'buy') {
                        if (coreMaintenanceIsEnabled) {
                            const maintenanceMessage = getDynamicMaintenanceMessage('buy', {
                                length: 3,
                                name: 'hours',
                            });

                            await WhatsAppBotService.sendWhatsappMessage(
                                phoneParams.businessPhoneNumberId,
                                MessageGenerators.generateTextMessage(
                                    phoneParams.userPhoneNumber,
                                    maintenanceMessage
                                )
                            );

                            return ActionExecuted.SEND_MAINTAINANCE_MESSAGE;
                        }

                        await WhatsAppBotService.handleBuyAssetAction(userV2, phoneParams, assetId);

                        return ActionExecuted.SEND_BUY_ASSET_MESSAGE;
                    }

                    if (assetAction === 'withdraw') {
                        if (coreMaintenanceIsEnabled) {
                            const maintenanceMessage = getDynamicMaintenanceMessage('withdraw', {
                                length: 3,
                                name: 'hours',
                            });

                            await WhatsAppBotService.sendWhatsappMessage(
                                phoneParams.businessPhoneNumberId,
                                MessageGenerators.generateTextMessage(
                                    phoneParams.userPhoneNumber,
                                    maintenanceMessage
                                )
                            );

                            return ActionExecuted.SEND_MAINTAINANCE_MESSAGE;
                        }

                        await WhatsAppBotService.handleWithdrawAssetAction(
                            userV2,
                            phoneParams,
                            assetId
                        );

                        return ActionExecuted.SEND_WITHDRAW_ASSET_MESSAGE;
                    }

                    if (assetAction === 'deposit') {
                        if (coreMaintenanceIsEnabled) {
                            const maintenanceMessage = getDynamicMaintenanceMessage('deposit', {
                                length: 3,
                                name: 'hours',
                            });

                            await WhatsAppBotService.sendWhatsappMessage(
                                phoneParams.businessPhoneNumberId,
                                MessageGenerators.generateTextMessage(
                                    phoneParams.userPhoneNumber,
                                    maintenanceMessage
                                )
                            );

                            return ActionExecuted.SEND_MAINTAINANCE_MESSAGE;
                        }

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

export const createWhatsappMessagingWorkerV2 = () => {
    return new Worker<WhatsAppBotMessagingQueueInput, WhatsAppBotMessagingQueueResult>(
        QueueNames.whatsappBotMessagingTemp,
        async (job) => {
            const { message, businessPhoneNumberId, displayName } = job.data;

            const actionExecuted = await handleIncomingWhatsappMessageV2(
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

            const result = await WhatsAppBotService.sendWhatsappMessage(
                businessPhoneNumberId,
                message
            );

            if (!result?.sent) {
                throw new Error('Message not sent');
            }

            return { status: 'success' };
        },
        {
            connection: connectionConfig,
            concurrency: 50,
            limiter: {
                max: 20,
                duration: 1000,
            },
            removeOnComplete: {
                age: 2 * 3600, // keep up to 2 hours,
                count: 1000, // keep up to 1000 jobs
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
