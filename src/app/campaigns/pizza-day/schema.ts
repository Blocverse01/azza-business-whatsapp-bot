import azzaWalletManager from '@/runtime/wallet';
import { z } from 'zod';

const supportedChains = azzaWalletManager.getSupportedNetworks();
const BLOCKCHAIN_ARG_DESCRIPTION = `Supported blockchains: ${supportedChains.join(', ')}. Correct user typos when their input is closely related to any of the Supported blockchain options`;

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
    selectedAsset: z
        .object({
            tokenName: z
                .string()
                .describe(
                    "An identifier for the token to debit from the user's wallet. Supported values: USDT, USDC. Correct user typos when their input is closely related to any of the Supported symbol options"
                ),
            blockchainNetwork: z
                .string()
                .nullable()
                .describe(
                    `The blockchain to use for the selected token. ${BLOCKCHAIN_ARG_DESCRIPTION}`
                ),
        })
        .nullable(),
    selectedAssetIndex: z
        .number()
        .describe(
            'An index that indicates the position of an asset option from the list of payment options provided to the user.'
        )
        .nullable(),
});

export type BuyPizzaPromptArgs = z.infer<typeof BuyPizzaPromptArgsSchema>;
