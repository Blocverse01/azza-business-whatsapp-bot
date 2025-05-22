import { z } from 'zod';

export const BuyPizzaPromptArgsSchema = z.object({
    fiatAmount: z
        .number()
        .positive()
        .nullable()
        .describe(
            'Amount to pay for pizza specified in a fiat currency, supported currencies: NGN'
        ),
    fiatCurrency: z
        .string()
        .nullable()
        .describe('Fiat currency to make payment in, supported currencies: NGN.'),
    destinationAccountNumber: z
        .string()
        .min(10)
        .max(10)
        .nullable()
        .describe('Account number to receive payment for Pizza.'),
    destinationBankName: z.string().nullable().describe('Bank name input provided by the user.'),
    hasConfirmedPayment: z
        .boolean()
        .describe('Boolean to track if the user has confirmed the payment details'),
});

export type BuyPizzaPromptArgs = z.infer<typeof BuyPizzaPromptArgsSchema>;
