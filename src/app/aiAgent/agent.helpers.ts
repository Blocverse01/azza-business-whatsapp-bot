import { dbClient } from '@/db/dbClient';

type StoredMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string;
    sessionId: string;
};

type UpdateUserAgentThreadParams = {
    ownerId: string;
    newMessages: Array<StoredMessage>;
    lastSessionId: string;
};

export const createOrUpdateUserAgentThread = async (params: UpdateUserAgentThreadParams) => {
    const { ownerId, newMessages, lastSessionId } = params;

    const thread = await dbClient.user_agent_thread
        .filter({
            ownerId: ownerId,
        })
        .getFirst();

    let messages = newMessages;

    if (!thread) {
        await dbClient.user_agent_thread.createOrUpdate({
            ownerId: ownerId,
            messages,
            lastSessionId,
        });
    } else {
        thread.messages.push(...messages);
        await thread.update({
            messages: thread.messages,
            lastSessionId,
        });
    }

    return ownerId;
};

export const getUserAgentThread = async (
    sessionId: string
): Promise<{
    lastSessionId: string;
    messages: Array<StoredMessage>;
}> => {
    const thread = await dbClient.user_agent_thread
        .filter({
            ownerId: sessionId,
        })
        .getFirst();

    return thread
        ? {
              lastSessionId: thread.lastSessionId,
              messages: thread.messages,
          }
        : {
              lastSessionId: '',
              messages: [],
          };
};
