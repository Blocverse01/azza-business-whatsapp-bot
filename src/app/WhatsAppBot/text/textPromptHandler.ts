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
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { FeatureAccessLevel } from '@/config/whatsAppBot';

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
    userFeatureAccessLevel: FeatureAccessLevel;
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
    const { storedMessages, lastSessionId, userFeatureAccessLevel } = params;

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

    // Step 1: Classify the action - LLM Usage 1
    const classifiedAction = await classifyAction(runtimeMessages);

    if (classifiedAction.class === 'NO_PREDEFINED_ACTION') {
        // Branch 1 [No identified action]: LLM Usage 2
        const response = await handleUserPrompt({
            messages: runtimeMessages,
            userProfile: {
                id: params.botParams.userPhoneNumber,
            },
        });

        const promptResponse = response.assistantMessage.content;
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

    console.log(classifiedAction);

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
                userFeatureAccessLevel,
            });
            break;

        case 'TRANSFER_CRYPTO':
        case 'WITHDRAW_CRYPTO':
            responseMessage = await handleWithdrawRelatedPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                userFeatureAccessLevel,
            });
            break;

        case 'QUERY_WALLET_BALANCE':
            responseMessage = await handleBalanceQueryPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                userFeatureAccessLevel,
            });
            break;

        case 'RESET_TRANSACTION_PIN':
            responseMessage = await handleResetTransactionPinPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                userFeatureAccessLevel,
            });
            break;

        case 'CHANGE_TRANSACTION_PIN':
            responseMessage = await handleChangeTransactionPinPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                userFeatureAccessLevel,
            });
            break;

        case 'BUY_CRYPTO_WITH_FIAT':
        case 'GET_CRYPTO_WITH_FIAT':
            responseMessage = await handleBuyCryptoWithFiatPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                userFeatureAccessLevel,
            });
            break;

        case 'SELL_CRYPTO_FOR_FIAT':
        case 'GET_FIAT_WITH_CRYPTO':
            responseMessage = await handleSellCryptoForFiatPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                userFeatureAccessLevel,
            });
            break;

        case 'SWAP_CRYPTO':
            responseMessage = await handleSwapCryptoPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                userFeatureAccessLevel,
            });
            break;
        case 'SHOW_FIAT_CONVERSION_RATES':
            responseMessage = await handleRatesPrompt({
                extractedArguments: extractedArguments,
                botParams: params.botParams,
                userFeatureAccessLevel,
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
