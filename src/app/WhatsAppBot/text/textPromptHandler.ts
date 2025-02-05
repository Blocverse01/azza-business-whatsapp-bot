import { handleUserPrompt } from '@/app/aiAgent/agent.prompter';
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
    handleRatesPrompt,
    handleResetTransactionPinPrompt,
    handleSellCryptoForFiatPrompt,
    handleSwapCryptoPrompt,
    handleWithdrawRelatedPrompt,
    PromptHandlerResponse,
} from '@/app/WhatsAppBot/text/actionHandlers';
import { actionArgumentsSchema } from '@/app/WhatsAppBot/text/classifiedActionSchema';
import { getWelcomeBackMessageText } from '@/app/WhatsAppBot/utils';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { UserV2Record } from '@/db/xata';
import logger from '@/resources/logger';

type TextPromptHandlerParams = {
    storedMessages: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
        sessionId: string;
    }>;
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

export const textPromptHandler = async (
    params: TextPromptHandlerParams
): Promise<TextPromptHandlerResponse> => {
    const { storedMessages, lastSessionId, user } = params;

    const runtimeMessages = (
        lastSessionId !== ''
            ? storedMessages.filter((message) => message.sessionId === lastSessionId)
            : []
    ).map((message) => ({
        role: message.role,
        content: message.content,
    }));

    runtimeMessages.push({
        role: 'user',
        content: params.prompt.trim(),
    });

    let classifiedAction: Action | null = null;

    try {
        // Step 1: Classify the action - LLM Usage 1
        classifiedAction = await classifyAction(runtimeMessages);
    } catch (error) {
        const response = await handleUserPrompt({
            messages: runtimeMessages,
            user: user,
            phoneParams: params.botParams,
        });

        const promptResponse = response.assistantMessage.content;
        await WhatsAppBotService.sendWhatsappMessage(
            params.botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, promptResponse)
        );

        await logger.error('Error in classifying action', {
            error,
            messages: runtimeMessages,
        });

        return {
            handledTextPrompt: true,
            classifiedAction: {
                class: 'NO_PREDEFINED_ACTION',
                confidence: 1,
            },
            prompt: params.prompt,
            promptHandlerResponse: {
                response: promptResponse,
                resetSession: false,
            },
        };
    }

    if (classifiedAction.class === 'NO_PREDEFINED_ACTION') {
        // Branch 1 [No identified action]: LLM Usage 2
        // const response = await handleUserPrompt({
        //     messages: runtimeMessages,
        //     user: user,
        //     phoneParams: params.botParams,
        // });
        //
        const promptResponse = getWelcomeBackMessageText();
        await WhatsAppBotService.sendWhatsappMessage(
            params.botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, promptResponse)
        );

        return {
            handledTextPrompt: true,
            classifiedAction: classifiedAction,
            prompt: params.prompt,
            promptHandlerResponse: {
                response: promptResponse,
                resetSession: false,
            },
        };
    }

    // Step 2: Extract the action arguments - LLM Usage 3
    const extractedArguments = await extractActionArgumentsFromMessages(
        classifiedAction.class,
        runtimeMessages,
        actionArgumentsSchema[classifiedAction.class]
    );

    let responseMessage: PromptHandlerResponse | null = null;

    switch (classifiedAction.class) {
        case 'DEPOSIT_CRYPTO_TO_WALLET':
        case 'SHOW_WALLET_ADDRESS':
            responseMessage = await handleDepositRelatedPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                user,
            });
            break;

        case 'TRANSFER_CRYPTO':
        case 'WITHDRAW_CRYPTO':
            responseMessage = await handleWithdrawRelatedPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                user,
            });
            break;

        case 'QUERY_WALLET_BALANCE':
            responseMessage = await handleBalanceQueryPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                user,
            });
            break;

        case 'RESET_TRANSACTION_PIN':
            responseMessage = await handleResetTransactionPinPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                user,
            });
            break;

        case 'CHANGE_TRANSACTION_PIN':
            responseMessage = await handleChangeTransactionPinPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                user,
            });
            break;

        case 'BUY_CRYPTO_WITH_FIAT':
        case 'GET_CRYPTO_WITH_FIAT':
            responseMessage = await handleBuyCryptoWithFiatPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                user,
            });
            break;

        case 'SELL_CRYPTO_FOR_FIAT':
        case 'GET_FIAT_WITH_CRYPTO':
            responseMessage = await handleSellCryptoForFiatPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                user,
            });
            break;

        case 'SWAP_CRYPTO':
            responseMessage = await handleSwapCryptoPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                user,
            });
            break;
        case 'SHOW_FIAT_RATES':
            responseMessage = await handleRatesPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                user,
            });
            break;
    }

    if (responseMessage) {
        return {
            handledTextPrompt: true,
            classifiedAction: classifiedAction,
            prompt: params.prompt,
            promptHandlerResponse: responseMessage,
        };
    }

    throw new Error('Action not supported');
};

export const getSessionId = (userId: string, action: string) => {
    return `${userId}-${action}`;
};
