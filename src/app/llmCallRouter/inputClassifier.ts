import { openai } from '@ai-sdk/openai';
import { CoreMessage, generateObject } from 'ai';
import { z, ZodSchema } from 'zod';

const actions = [
    'SHOW_WALLET_ADDRESS',
    'QUERY_WALLET_BALANCE',
    'TRANSFER_CRYPTO',
    'WITHDRAW_CRYPTO',
    'CHANGE_TRANSACTION_PIN',
    'RESET_TRANSACTION_PIN',
    'DEPOSIT_CRYPTO_TO_WALLET',
    'BUY_CRYPTO_WITH_FIAT',
    'SELL_CRYPTO_FOR_FIAT',
    'SWAP_CRYPTO',
    'GET_FIAT_WITH_CRYPTO',
    'GET_CRYPTO_WITH_FIAT',
    'SHOW_FIAT_RATES',
] as const;
const actionClassSchema = z.enum(actions);

type ActionClass = z.infer<typeof actionClassSchema>;

const actionSchema = z.object({
    class: actionClassSchema.or(z.literal('NO_PREDEFINED_ACTION')),
    confidence: z.number(),
});
export type Action = z.infer<typeof actionSchema>;

const getChoiceString = (choices: readonly string[]): string => {
    return choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n');
};

const choiceString = getChoiceString(actions);

export const classifyAction = async (messages: Array<CoreMessage>): Promise<Action> => {
    const result = await generateObject({
        model: openai('gpt-4o'),
        system: `Some choices are given below. It is provided in a numbered list, where each item in the list corresponds to a followup task to be performed.\n----------------\n${choiceString}\n----------------\nUsing only the choices above and not prior knowledge, return the top choice that is most relevant to the given input. If none of the choices are relevant, return 'NO_PREDEFINED_ACTION'.`,
        messages: messages,
        schema: z.object({
            action: actionSchema.optional().nullable(),
        }),
    });

    return result.object.action ?? { class: 'NO_PREDEFINED_ACTION', confidence: 1 };
};

export const extractActionArgumentsFromMessages = async <T extends ZodSchema>(
    actionClass: ActionClass,
    messages: Array<CoreMessage>,
    schema: T
) => {
    const result = await generateObject({
        model: openai('gpt-4o'),
        system: `Given the action class ${actionClass}, extract the arguments required to perform the action from the given messages. If an argument doesn't exist, return null. Never assume any argument that is not explicitly mentioned in the messages.`,
        messages: messages,
        schema: z.object({
            args: schema.optional().nullable(),
        }),
    });

    return result.object.args ? (result.object.args as z.infer<T>) : null;
};
