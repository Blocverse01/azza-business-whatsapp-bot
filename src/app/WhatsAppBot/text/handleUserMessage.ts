import {
    getConversationHistory,
    getMessageThread,
    storeUserMessage,
} from '@/app/aiAgent/conversation-manager';
import { UserV2Record } from '@/db/xata';
import logger from '@/resources/logger';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import { StoredMessage, textPromptHandler, getSessionId } from './textPromptHandler';
import { PhoneNumberParams } from '../WhatsAppBotType';

export const handleUserMessage = async (params: {
    message: string;
    user: UserV2Record;
    phoneParams: PhoneNumberParams;
}) => {
    const { message, user, phoneParams } = params;

    // Retrieve conversation history including summaries
    const [conversationHistory, messageThread] = await Promise.all([
        getConversationHistory(user.id),
        getMessageThread(user.id),
    ]);

    // Build messages including summaries
    const storedMessages: Array<StoredMessage> = [
        ...conversationHistory.messages.map(
            (msg) =>
                ({
                    role: 'user',
                    content: msg.content,
                    sessionId: msg.sessionId,
                }) satisfies StoredMessage
        ),
    ];

    // Add latest summary as a system message if available
    if (conversationHistory.latestSummary) {
        storedMessages.unshift({
            role: 'system',
            content: `Summary of previous messages: ${conversationHistory.latestSummary}`,
            sessionId: 'summary',
        });
    }

    const result = await textPromptHandler({
        storedMessages,
        lastSessionId: messageThread.lastSessionId,
        prompt: message,
        botParams: phoneParams,
        user: user,
    });

    if (result.handledTextPrompt) {
        const sessionId = getSessionId(phoneParams.userPhoneNumber, result.classifiedAction.class);

        try {
            await storeUserMessage({
                ownerId: user.id,
                content: result.prompt,
                sessionId: sessionId,
            });
        } catch (error) {
            const parsedError = parseUnknownError(error);
            await logger.error(parsedError.message, {
                error: parsedError,
            });
        }
    }

    return result;
};
