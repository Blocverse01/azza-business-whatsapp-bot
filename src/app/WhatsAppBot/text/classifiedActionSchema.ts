import { Action } from '@/app/llmCallRouter/inputClassifier';
import { SUPPORTED_CHAINS } from '@/app/WalletKit/walletKitSchema';
import { z, ZodSchema } from 'zod';

export const assetAndNetworkSchema = z.object({
    blockchainNetwork: z
        .string()
        .nullable()
        .describe(
            `The blockchain network to use for the action. Supported networks: ${SUPPORTED_CHAINS.join(', ')}`
        ),
    cryptoCurrencySymbol: z
        .string()
        .nullable()
        .describe('The cryptocurrency symbol to use for the action'),
});

export const actionArgumentsSchema = {
    SHOW_WALLET_ADDRESS: assetAndNetworkSchema,
    QUERY_WALLET_BALANCE: assetAndNetworkSchema,
    TRANSFER_CRYPTO: z
        .object({
            amount: z.number().nullable(),
            recipientAddressOrPhoneNumber: z
                .string()
                .nullable()
                .describe('The recipient wallet address or phone number to send to.'),
            hasConfirmedTransfer: z.boolean().nullable(),
        })
        .merge(assetAndNetworkSchema),
    WITHDRAW_CRYPTO: z
        .object({
            amount: z.number().nullable(),
            recipientAddressOrPhoneNumber: z
                .string()
                .nullable()
                .describe('The recipient wallet address or phone number to send to.'),
            hasConfirmedTransfer: z.boolean().nullable(),
        })
        .merge(assetAndNetworkSchema),
    CHANGE_TRANSACTION_PIN: z.object({}),
    RESET_TRANSACTION_PIN: z.object({}),
    DEPOSIT_CRYPTO_TO_WALLET: assetAndNetworkSchema,
    BUY_CRYPTO_WITH_FIAT: assetAndNetworkSchema,
    SELL_CRYPTO_FOR_FIAT: assetAndNetworkSchema,
    GET_CRYPTO_WITH_FIAT: assetAndNetworkSchema,
    GET_FIAT_WITH_CRYPTO: assetAndNetworkSchema,
    SWAP_CRYPTO: z.object({
        fromBlockchainNetwork: z
            .string()
            .nullable()
            .describe('The blockchain network to swap from.'),
        fromCryptoCurrencySymbol: z
            .string()
            .nullable()
            .describe('The cryptocurrency symbol to swap from.'),
        toBlockchainNetwork: z
            .string()
            .nullable()
            .describe(
                'The blockchain network to swap to. Should be the same as the fromBlockchainNetwork if not provided.'
            ),
        toCryptoCurrencySymbol: z
            .string()
            .nullable()
            .describe('The cryptocurrency symbol to swap to.'),
        fromAmount: z.number().nullable().describe('The amount of cryptocurrency to swap.'),
        hasConfirmedSwap: z.boolean().nullable(),
    }),
} as const satisfies Record<Exclude<Action['class'], 'NO_PREDEFINED_ACTION'>, ZodSchema>;
