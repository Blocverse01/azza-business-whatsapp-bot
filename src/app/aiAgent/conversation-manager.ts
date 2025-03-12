import { dbClient, sqlClient } from '@/db/dbClient';
import { UserMessage } from '@/db/xata';
import { openai } from '@ai-sdk/openai';
import { generateText, embed } from 'ai';

export const storeUserMessage = async (params: {
    ownerId: string;
    content: string;
    sessionId: string;
    shouldResetLastSessionId?: boolean;
}) => {
    const { ownerId, content, sessionId, shouldResetLastSessionId } = params;

    let thread = await dbClient.user_agent_thread.filter({ ownerId }).getFirst();

    if (!thread) {
        thread = await dbClient.user_agent_thread.create({
            ownerId: ownerId,
            lastSessionId: sessionId,
        });
    } else {
        await dbClient.user_agent_thread.update(thread.id, {
            lastSessionId: shouldResetLastSessionId ? '' : sessionId,
        });
    }

    await dbClient.user_message.create({
        threadId: thread.id,
        content,
        sessionId: sessionId,
    });

    // Check if it's time to summarize
    // const messageCount = (await dbClient.user_message.filter({ threadId: thread.id }).getAll())
    //     .length;

    // if (messageCount % 5 === 0) {
    //     await generateAndStoreSummary(thread.id);
    // }

    return thread.id;
};

export const generateAndStoreSummary = async (threadId: string) => {
    const messages = (
        await sqlClient<UserMessage>({
            statement: `
            SELECT content 
            FROM user_message 
            WHERE "threadId" = $1 
            ORDER BY "xata.createdAt" DESC 
            LIMIT 10;`,
            params: [threadId],
        })
    ).records;

    if (messages.length === 0) return;

    const textToSummarize = messages.map((m) => m.content).join('\n');

    const { text: summaryText } = await generateText({
        model: openai('gpt-4o-mini'),
        messages: [
            { role: 'system', content: 'Summarize the following user messages:' },
            { role: 'user', content: textToSummarize },
        ],
        maxTokens: 100,
    });

    // Generate vector embedding
    const { embedding } = await embed({
        model: openai.embedding('text-embedding-3-small'),
        value: summaryText,
    });

    // Store summary in Xata
    await dbClient.conversation_summary.create({
        threadId: threadId,
        summary: summaryText,
        embedding,
    });
};

export const getMessageThread = async (ownerId: string) => {
    const thread = await dbClient.user_agent_thread.filter({ ownerId }).getFirst();
    if (!thread) return { lastSessionId: '' };

    return thread;
};

export const getConversationHistory = async (ownerId: string) => {
    const thread = await dbClient.user_agent_thread.filter({ ownerId }).getFirst();
    if (!thread) return { messages: [], latestSummary: null };

    const messages = (
        await sqlClient<UserMessage>({
            statement: `
            SELECT "content","sessionId" 
            FROM user_message 
            WHERE "threadId" = $1 
            ORDER BY "xata.createdAt" DESC 
            LIMIT 20;`,
            params: [thread.id],
        })
    ).records;

    const latestSummary = await dbClient.conversation_summary
        .filter({ threadId: thread.id })
        .sort('xata.createdAt', 'desc')
        .getFirst();

    return {
        messages: messages.map((m) => ({ content: m.content, sessionId: m.sessionId })),
        latestSummary: latestSummary ? latestSummary.summary : null,
    };
};

export const getRelevantSummary = async (query: string, threadId: string) => {
    const { embedding: queryEmbedding } = await embed({
        model: openai.embedding('text-embedding-3-small'),
        value: query,
    });

    // Perform vector search in Xata
    const { records: relevantSummaries } = await dbClient.conversation_summary.vectorSearch(
        'embedding', // Column storing vector embeddings
        queryEmbedding,
        {
            filter: { threadId }, // Ensure search is scoped to the correct conversation thread
            size: 3, // Fetch the top 3 most relevant summaries
        }
    );

    // If no relevant results, fallback to the latest summary
    if (relevantSummaries.length === 0) {
        const latestSummary = await dbClient.conversation_summary
            .filter({ threadId })
            .sort('xata.createdAt', 'desc')
            .getFirst();
        return latestSummary ? [latestSummary.summary] : [];
    }

    return relevantSummaries.map((s) => s.summary);
};
