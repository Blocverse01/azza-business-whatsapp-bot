import { openai } from '@ai-sdk/openai';
import { CoreMessage, generateObject } from 'ai';
import { z, ZodSchema } from 'zod';

const actions = [
    'CANCEL_CURRENT_ACTION',
    'PAY_TO_BANK_ACCOUNT',
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
    'KYC_VERIFICATION',
    'REFERRAL_REQUEST',
    'REFERRAL_CODE',
    'REQUEST_SUPPORT',
    'ACCOUNT_STATEMENT',
    'TRANSACTION_HISTORY',
    'DOWNLOAD_ACCOUNT_STATEMENT',
    'BUY_DATA',
    'PURCHASE_DATA',
    'DATA_BUNDLE',
    'DATA_TOPUP',
    'BUY_AIRTIME',
    'PURCHASE_AIRTIME',
    'AIRTIME_TOPUP',
    'AGENT_SELL_CRYPTO_FOR_FIAT',
    'AGENT_GET_FIAT_WITH_CRYPTO',
    'AGENT_BUY_CRYPTO_WITH_FIAT',
    'AGENT_GET_CRYPTO_WITH_FIAT',
    'AGENT_BALANCE',
    'AGENT_EARNINGS',
    'RECEIVE_PAYMENT',
    'RECEIVE_CRYPTO_PAYMENT'
] as const;
const actionClassSchema = z.enum(actions);

type ActionClass = z.infer<typeof actionClassSchema>;

const actionDescriptions: Record<ActionClass, string> = {
    CANCEL_CURRENT_ACTION: 'Cancel the currently ongoing action or request.',
    PAY_TO_BANK_ACCOUNT:
        'Make a fiat payment to a bank account using crypto assets. Involves converting cryptocurrency to Nigerian Naira (NGN) and transferring to specified bank account details. Messages typically mention payment amounts, bank names, account numbers, or naira transfers.',
    SHOW_WALLET_ADDRESS: 'Show the user their crypto wallet address for receiving funds.',
    QUERY_WALLET_BALANCE: 'Check the balance of the user’s wallet.',
    TRANSFER_CRYPTO: 'Send cryptocurrency to another wallet address.',
    WITHDRAW_CRYPTO:
        'Withdraw crypto from the wallet to an external account. May include “send,” “cash out,” or similar language.',
    CHANGE_TRANSACTION_PIN: 'Change the user’s transaction PIN.',
    RESET_TRANSACTION_PIN: 'Reset the user’s transaction PIN.',
    DEPOSIT_CRYPTO_TO_WALLET: 'Receive or deposit crypto into the wallet.',
    BUY_CRYPTO_WITH_FIAT: 'Buy crypto using fiat currency like NGN. Example prompt: /buy',
    SELL_CRYPTO_FOR_FIAT: 'Sell crypto to receive fiat currency. Example prompt: /sell',
    SWAP_CRYPTO: 'Swap one crypto asset for another. example prompt: /swap',
    GET_FIAT_WITH_CRYPTO: 'Exchange crypto to get fiat. Overlaps with sell. Example prompt: /sell',
    GET_CRYPTO_WITH_FIAT: 'Exchange fiat to get crypto. Overlaps with buy. Example prompt: /buy',
    SHOW_FIAT_RATES: 'Show current exchange rates between fiat and crypto.',
    KYC_VERIFICATION: 'Start or check the KYC verification process.',
    REFERRAL_REQUEST: 'Request a referral link or details.',
    REFERRAL_CODE: 'Request a referral link or details. Overlaps with referral request',
    REQUEST_SUPPORT: 'Request support or assistance with an issue.',
    ACCOUNT_STATEMENT: 'Get a summary of your recent financial activity or transactions.',
    TRANSACTION_HISTORY: 'View a list of all past fiat transactions.',
    DOWNLOAD_ACCOUNT_STATEMENT: 'Download a detailed statement of your account activity.',
    BUY_DATA: 'Purchase a data bundle for internet access on a mobile network.',
    PURCHASE_DATA: 'Buy a data bundle for internet access on a mobile network. Overlaps with .',
    DATA_BUNDLE: 'Initiate a request to view or purchase available data bundles.',
    DATA_TOPUP: 'Add more data to an existing mobile data plan or purchase a new data bundle.',
    BUY_AIRTIME: 'Purchase mobile airtime credit for calls and SMS.',
    PURCHASE_AIRTIME: 'Buy mobile airtime credit for calls and SMS. Overlaps with buy airtime.',
    AIRTIME_TOPUP: 'Add more airtime credit to your mobile phone for calls and SMS',
    AGENT_SELL_CRYPTO_FOR_FIAT:
        'A P2P merchant helps a user sell crypto for fiat currency (e.g., NGN).',
    AGENT_GET_FIAT_WITH_CRYPTO:
        'A P2P merchant helps a user exchange crypto for fiat currency. Overlaps with P2P merchant sell crypto for fiat.',
    AGENT_BUY_CRYPTO_WITH_FIAT:
        'A P2P merchant helps a user buy crypto with fiat currency (e.g., NGN).',
    AGENT_GET_CRYPTO_WITH_FIAT:
        'A P2P merchant helps a user exchange fiat for crypto currency. Overlaps with P2P merchant buy crypto with fiat.',
    AGENT_EARNINGS: 'P2P merchant views total commissions and rewards.',
    AGENT_BALANCE: 'P2P merchant checks current operational balance.',
    RECEIVE_PAYMENT: 'Accept payments from customers in cryptocurrency.',
    RECEIVE_CRYPTO_PAYMENT: 'Generate a crypto address or QR code to easily to receive payments'
};
const actionSchema = z.object({
    class: actionClassSchema.or(z.literal('NO_PREDEFINED_ACTION')),
    confidence: z.number(),
});
export type Action = z.infer<typeof actionSchema>;

const getChoiceString = (choices: readonly string[]): string => {
    return choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n');
};

const formattedChoiceString = getChoiceString(
    actions.map((a) => `${a} - ${actionDescriptions[a]}`)
);

export const classifyAction = async (messages: Array<CoreMessage>): Promise<Action> => {
    const result = await generateObject({
        model: openai('gpt-4o'),
        system: `You're a smart assistant that must classify user intent based on a set of predefined actions. Each action has a description. Classify ONLY based on these descriptions — do not use assumptions or unrelated prior knowledge.

        ----------------
        ${formattedChoiceString}
        ---------------- 

        Guidelines:
        - If none of the choices are relevant, return 'NO_PREDEFINED_ACTION'.
        - If the most recent message stands out significantly from the previous messages, classify it based on that message alone.
        
        Now, from the conversation below, choose the most relevant action.
        `,
        messages: messages,
        schema: z.object({
            action: actionSchema.optional().nullable(),
        }),
        temperature: 0,
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
        system: `Given the action class ${actionClass}, extract the arguments required to perform the action from the given messages. If an argument doesn't exist, return null. Never assume any argument that is not explicitly mentioned in the messages. When extracting arguments from the message, ALWAYS check all the messages passed and find the most recent compatible information for the arguments. This is very useful when the user sends a new message updating their previous request`,
        messages: messages,
        schema: z.object({
            args: schema
                .optional()
                .nullable()
                .describe(
                    "An object that contains the arguments to extracted from the user's messages"
                ),
        }),
        temperature: 0,
    });

    return result.object.args ? (result.object.args as z.infer<T>) : null;
};
