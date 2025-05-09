import { handleUserPrompt } from '@/app/aiAgent/agent.prompter';
import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import {
    Action,
    classifyAction,
    extractActionArgumentsFromMessages,
} from '@/app/llmCallRouter/inputClassifier';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import {
    handleBalanceQueryPrompt,
    handleBuyCryptoWithFiatPrompt,
    handleChangeTransactionPinPrompt,
    handleDepositRelatedPrompt,
    handleKycPrompt,
    handleRatesPrompt,
    handleReferralPrompt,
    handleResetTransactionPinPrompt,
    handleSellCryptoForFiatPrompt,
    handleSwapCryptoPrompt,
    handleWithdrawRelatedPrompt,
    PromptHandlerResponse,
} from '@/app/WhatsAppBot/text/actionHandlers';
import { actionArgumentsSchema } from '@/app/WhatsAppBot/text/classifiedActionSchema';
import { getWelcomeBackMessageText } from '@/app/WhatsAppBot/utils';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { FeatureAccessLevel } from '@/config/whatsAppBot';
import { getDynamicMaintenanceMessage } from '@/constants/strings';
import { UserV2Record } from '@/db/xata';
import logger from '@/resources/logger';

export type StoredMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string;
    sessionId: string;
};

type TextPromptHandlerParams = {
    storedMessages: Array<StoredMessage>;
    lastSessionId: string;
    prompt: string;
    botParams: {
        userPhoneNumber: string;
        businessPhoneNumberId: string;
    };
    user: UserV2Record;
};

type TextPromptHandlerResponse = {
    handledTextPrompt: boolean;
    classifiedAction: Action;
    prompt: string;
    promptHandlerResponse: PromptHandlerResponse;
};

const checkAndHandleMaintenance = async (
    actionType: string,
    phoneParams: TextPromptHandlerParams['botParams']
) => {
    const coreMaintainanceIsEnabled = await FeatureFlagService.isFeatureEnabled(
        FeatureFlagKey.CORE_MAINTAINANCE
    );
    if (coreMaintainanceIsEnabled) {
        const message = getDynamicMaintenanceMessage(actionType, { length: 3, name: 'hours' });
        await WhatsAppBotService.sendWhatsappMessage(
            phoneParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, message)
        );
        return { response: message, resetSession: false };
    }
    return null;
};

export const textPromptHandler = async (
    params: TextPromptHandlerParams
): Promise<TextPromptHandlerResponse> => {
    const { storedMessages, lastSessionId, user, prompt, botParams } = params;

    const runtimeMessages = storedMessages
        .filter((message) => message.sessionId === lastSessionId)
        .slice(-10)
        .map((message) => ({
            role: message.role,
            content: message.content,
            sessionId: message.sessionId,
        }))
        .reverse();

    runtimeMessages.push({ role: 'user', content: prompt.trim(), sessionId: '' });

    let classifiedAction: Action;
    try {
        classifiedAction = await classifyAction(runtimeMessages);
    } catch (error) {
        const response = await handleUserPrompt({
            messages: runtimeMessages,
            user,
            phoneParams: botParams,
        });
        const promptResponse = response.assistantMessage.content;
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(botParams.userPhoneNumber, promptResponse)
        );
        await logger.error('Error in classifying action', { error, messages: runtimeMessages });
        return {
            handledTextPrompt: true,
            classifiedAction: { class: 'NO_PREDEFINED_ACTION', confidence: 1 },
            prompt,
            promptHandlerResponse: { response: promptResponse, resetSession: false },
        };
    }

    if (classifiedAction.class === 'NO_PREDEFINED_ACTION') {
        const promptResponse = getWelcomeBackMessageText();
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(botParams.userPhoneNumber, promptResponse)
        );
        return {
            handledTextPrompt: true,
            classifiedAction,
            prompt,
            promptHandlerResponse: { response: promptResponse, resetSession: false },
        };
    }

    const extractedArguments = await extractActionArgumentsFromMessages(
        classifiedAction.class,
        runtimeMessages,
        actionArgumentsSchema[classifiedAction.class]
    );

    let responseMessage = await checkAndHandleMaintenance(classifiedAction.class, botParams);
    if (!responseMessage) {
        switch (classifiedAction.class) {
            case 'DEPOSIT_CRYPTO_TO_WALLET':
            case 'SHOW_WALLET_ADDRESS':
                responseMessage = await handleDepositRelatedPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'TRANSFER_CRYPTO':
            case 'WITHDRAW_CRYPTO':
                responseMessage = await handleWithdrawRelatedPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'QUERY_WALLET_BALANCE':
                responseMessage = await handleBalanceQueryPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'RESET_TRANSACTION_PIN':
                responseMessage = await handleResetTransactionPinPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'CHANGE_TRANSACTION_PIN':
                responseMessage = await handleChangeTransactionPinPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'BUY_CRYPTO_WITH_FIAT':
            case 'GET_CRYPTO_WITH_FIAT':
                responseMessage = await handleBuyCryptoWithFiatPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'SELL_CRYPTO_FOR_FIAT':
            case 'GET_FIAT_WITH_CRYPTO':
                responseMessage = await handleSellCryptoForFiatPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'SWAP_CRYPTO':
                responseMessage = await handleSwapCryptoPrompt(
                    {
                        extractedArguments,
                        botParams,
                        user,
                    },
                    FeatureAccessLevel.PRODUCTION
                );
                break;
            case 'SHOW_FIAT_RATES':
                responseMessage = await handleRatesPrompt({ extractedArguments, botParams, user });
                break;
            case 'REFERRAL_REQUEST':
            case 'REFERRAL_CODE':
                responseMessage = await handleReferralPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'KYC_VERIFICATION':
                responseMessage = await handleKycPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            default:
                console.error('Unrecognized action class:', classifiedAction.class);
                throw new Error('Action not supported');
        }
    }

    return {
        handledTextPrompt: true,
        classifiedAction,
        prompt,
        promptHandlerResponse: responseMessage,
    };
};

export const getSessionId = (userId: string, action: string) => `${userId}-${action}`;
