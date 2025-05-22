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
        .describe(
            'Fiat currency to make payment in, supported currencies: NGN. If no one is specified default to NGN'
        )
        .default('NGN'),
    destinationAccountNumber: z
        .string()
        .min(10)
        .max(10)
        .nullable()
        .describe('Account number to receive payment for Pizza.'),
    destinationBankName: z.string().nullable().describe('Bank name input provided by the user.'),
    hasConfirmedPayment: z
        .boolean()
        .describe('Boolean to track if the user has confirmed the payment details')
        .default(false),
    selectedAssetToken: z
        .string()
        .describe("An identifier for the token to debit from the user's wallet")
        .nullable(),
    selectedAssetIndex: z
        .number()
        .describe(
            'An index that indicates the position of an asset option from the list of payment options provided to the user.'
        )
        .nullable(),
});

export type BuyPizzaPromptArgs = z.infer<typeof BuyPizzaPromptArgsSchema>;
