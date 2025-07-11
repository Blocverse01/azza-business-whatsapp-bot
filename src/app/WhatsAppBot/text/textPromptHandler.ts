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
    handlePayRelatedPrompt,
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
    handleSupportRelatedPrompt,
    handleAccountStatementRelatedPrompt,
    handleAirtimePurchasePrompt,
    handleDataBundlePurchasePrompt,
    handleAgentSellCryptoForFiatPrompt,
    handleAgentBuyCryptoWithFiatPrompt,
    handleAgentEarningPrompt
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
        waDisplayName: string;
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

    console.dir(runtimeMessages);

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

    if (classifiedAction.class === 'CANCEL_CURRENT_ACTION') {
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(botParams.userPhoneNumber, 'Request cancelled')
        );
        return {
            handledTextPrompt: true,
            classifiedAction,
            prompt,
            promptHandlerResponse: { response: 'Request cancelled', resetSession: true },
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
            case 'AGENT_SELL_CRYPTO_FOR_FIAT':
            case 'AGENT_GET_FIAT_WITH_CRYPTO':
                responseMessage = await handleAgentSellCryptoForFiatPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'AGENT_BUY_CRYPTO_WITH_FIAT':
            case 'AGENT_GET_CRYPTO_WITH_FIAT':
                responseMessage = await handleAgentBuyCryptoWithFiatPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'AGENT_EARNINGS':
            case 'AGENT_BALANCE' :
                responseMessage = await handleAgentEarningPrompt({
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
            case 'PAY_TO_BANK_ACCOUNT':
                responseMessage = await handlePayRelatedPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
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
            case 'REQUEST_SUPPORT':
                responseMessage = await handleSupportRelatedPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'ACCOUNT_STATEMENT':
            case 'DOWNLOAD_ACCOUNT_STATEMENT':
            case 'TRANSACTION_HISTORY':
                responseMessage = await handleAccountStatementRelatedPrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'BUY_AIRTIME':
            case 'PURCHASE_AIRTIME':
            case 'AIRTIME_TOPUP':
                responseMessage = await handleAirtimePurchasePrompt({
                    extractedArguments,
                    botParams,
                    user,
                });
                break;
            case 'BUY_DATA':
            case 'PURCHASE_DATA':
            case 'DATA_BUNDLE':
            case 'DATA_TOPUP':
                responseMessage = await handleDataBundlePurchasePrompt({
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
