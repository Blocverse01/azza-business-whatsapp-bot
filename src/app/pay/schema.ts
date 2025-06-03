import azzaWalletManager from '@/runtime/wallet';
import { z } from 'zod';

const supportedChains = azzaWalletManager.getSupportedNetworks();
const BLOCKCHAIN_ARG_DESCRIPTION = `Supported blockchains: ${supportedChains.join(', ')}. Correct user typos when their input is closely related to any of the Supported blockchain options`;

export const PayPromptArgsSchema = z.object({
    fiatAmount: z
        .number()
        .positive()
        .nullable()
        .describe('Amount to pay for pizza specified in a fiat currency, supported currencies: NGN')
        .default(null),
    fiatCurrency: z
        .string()
        .nullable()
        .optional()
        .describe(
            'Fiat currency to make payment in, supported currencies: NGN. If no one is specified default to NGN'
        )
        .default('NGN'),
    destinationAccountNumber: z
        .string()
        .nullable()
        .default(null)
        .describe('Account number to receive payment for Pizza. Usually 10 digits'),
    destinationBankName: z
        .string()
        .nullable()
        .default(null)
        .describe('Bank name input provided by the user.'),
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
                )
                .optional()
                .nullable(),
            blockchainNetwork: z
                .string()
                .optional()
                .nullable()
                .describe(
                    `The blockchain to use for the selected token. ${BLOCKCHAIN_ARG_DESCRIPTION}`
                ),
        })
        .optional()
        .nullable(),
    selectedAssetIndex: z
        .number()
        .describe(
            'An index that indicates the position of an asset option from the list of payment options provided to the user.'
        )
        .optional()
        .nullable(),
});

export type PayPromptArgs = z.infer<typeof PayPromptArgsSchema>;
