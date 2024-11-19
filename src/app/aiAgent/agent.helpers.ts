import { convertAsciiStringToBase64 } from '@/resources/utils/encryption';
import { CoreMessage } from 'ai';
import { dbClient } from '@/db/dbClient';

type UpdateUserAgentThreadParams = {
    userId: string;
    newMessages: Array<CoreMessage>;
};

export const createOrUpdateUserAgentThread = async (params: UpdateUserAgentThreadParams) => {
    const { userId, newMessages } = params;

    const thread = await dbClient.user_agent_thread
        .filter({
            user: userId,
        })
        .getFirst();

    let messages = newMessages;

    if (!thread?.messages.length) {
        messages = [
            {
                role: 'system',
                content: `Here's the user's system-provided ID: '${convertAsciiStringToBase64(userId)}'. Always use this value for the 'userId' parameter in tool calls, extract it without any confirmation from the user.`,
            },
            ...newMessages,
        ];
    }

    if (!thread) {
        await dbClient.user_agent_thread.create({
            user: userId,
            messages,
        });
    } else {
        thread.messages.push(...messages);
        await thread.update({
            messages: thread.messages,
        });
    }

    return userId;
};

export const getUserAgentThread = async (sessionId: string): Promise<Array<CoreMessage>> => {
    const thread = await dbClient.user_agent_thread
        .filter({
            user: sessionId,
        })
        .getFirst();

    return (thread?.messages ?? []) as Array<CoreMessage>;
};
