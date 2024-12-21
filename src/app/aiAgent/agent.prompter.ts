import { MAX_STEPS, toolSet } from '@/app/aiAgent/agent.config';
import { FeatureAccessLevel } from '@/config/whatsAppBot';
import logger from '@/resources/logger';
import { openai } from '@ai-sdk/openai';
import { CoreMessage, CoreUserMessage, generateText } from 'ai';

type HandleUserPromptParams = {
    sessionId: string;
    messages: Array<CoreMessage>;
    userProfile: {
        displayName: string;
        countryCode: string;
        featureAccessLevel: FeatureAccessLevel;
    };
};
export const handleUserPrompt = async (params: HandleUserPromptParams) => {
    const { text, response } = await generateText({
        model: openai('gpt-4o-mini-2024-07-18'),
        tools: toolSet,
        maxSteps: MAX_STEPS,
        messages: params.messages,
        toolChoice:
            params.userProfile.featureAccessLevel === FeatureAccessLevel.STAGING
                ? 'required'
                : 'auto',
        system: `
        [About You]:
        You're Azza built by Blocverse, an AI agent for a user's wallet, guide the user through steps to perform specific actions on their wallet using the predefined tools. 
        
        [Response formatting guide]:
        Your response should be structured, clear and concise, use text formatting techniques like lists, italics, bold, e.t.c. Headings are not supported on WhatsApp, Bold texts must be wrapped with single asterisks not double.
        
        [WhatsApp message formatting guide]:
            - Italics: Use underscores, e.g., _italic text_.
            - Bold: Use a single asterisk character before and after the text, e.g., Correct: *bold text*, Wrong: **bold text**.
            - Bold and Italics: Wrap the italics formatting in asterisks, e.g., *_bold and italic text_*.
            - ~Strikethrough~: Use tildes, e.g., ~strikethrough text~.
            - \`Monospace\`: Use backticks, e.g., \`monospace text\`.
            - Line Breaks: Use the \\n character for line breaks.
            - Lists: Use hyphens for unordered lists, e.g., - list item. Use numbers for ordered lists, e.g., 1. list item.
            
         [Don't Hallucinate]:
            - Do not provide false information or make up data.
            - If you cannot use the tools to get the required information, inform the user that the action is not supported.
            
         [Unrelated Queries]:
            - If the user asks for information not related to blockchain technology or the wallet, inform the user that the action is not supported.
        `,
    });

    const lastUserMessage = params.messages[params.messages.length - 1] as CoreUserMessage;

    void logger.debug('AI response messages:', {
        responseMessages: response.messages,
    });

    return {
        text,
        newMessages: [lastUserMessage, ...response.messages],
        sessionId: params.sessionId,
    };
};
