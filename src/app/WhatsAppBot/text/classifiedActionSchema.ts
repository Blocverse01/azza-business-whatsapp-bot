import { PayPromptArgsSchema } from '@/app/pay/schema';
import { Action } from '@/app/llmCallRouter/inputClassifier';
import azzaWalletManager from '@/runtime/wallet';
import { z, ZodSchema } from 'zod';

const supportedChains = azzaWalletManager.getSupportedNetworks();
const supportedTokenNames = azzaWalletManager.getSupportedAssets().map((asset) => asset.tokenName);
const uniqueSupportedTokenNames = Array.from(new Set(supportedTokenNames));

const BLOCKCHAIN_ARG_DESCRIPTION = `Supported blockchains: ${supportedChains.join(', ')}. Correct user typos when their input is closely related to any of the Supported blockchain options`;
const CRYPTO_CURRENCY_SYMBOL_ARG_DESCRIPTION = `Supported symbols: ${uniqueSupportedTokenNames.join(', ')}. Correct user typos when their input is closely related to any of the Supported symbol options`;

export const assetAndNetworkSchema = z.object({
    blockchainNetwork: z
        .string()
        .nullable()
        .describe(`The blockchain to use for the action. ${BLOCKCHAIN_ARG_DESCRIPTION}`),
    cryptoCurrencySymbol: z
        .string()
        .nullable()
        .describe(
            `The cryptocurrency symbol to use for the action. ${CRYPTO_CURRENCY_SYMBOL_ARG_DESCRIPTION}`
        )
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
            .describe(`The blockchain network to swap from. ${BLOCKCHAIN_ARG_DESCRIPTION}`),
        fromCryptoCurrencySymbol: z
            .string()
            .nullable()
            .describe(
                `The cryptocurrency symbol to swap from. ${CRYPTO_CURRENCY_SYMBOL_ARG_DESCRIPTION}`
            ),
        toBlockchainNetwork: z
            .string()
            .nullable()
            .describe(
                `The blockchain network to swap to. Should be the same as the fromBlockchainNetwork if not provided. ${BLOCKCHAIN_ARG_DESCRIPTION}`
            ),
        toCryptoCurrencySymbol: z
            .string()
            .nullable()
            .describe(
                `The cryptocurrency symbol to swap to. ${CRYPTO_CURRENCY_SYMBOL_ARG_DESCRIPTION}`
            ),
        fromAmount: z.number().nullable().describe('The amount of cryptocurrency to swap.'),
        hasConfirmedSwap: z.boolean().nullable(),
    }),
    SHOW_FIAT_RATES: z.object({}),
    KYC_VERIFICATION: z.object({}),
    REFERRAL_CODE: z.object({}),
    REFERRAL_REQUEST: z.object({}),
    CANCEL_CURRENT_ACTION: z.object({}),
    PAY_TO_BANK_ACCOUNT: PayPromptArgsSchema,
    REQUEST_SUPPORT: z.object({}),
    ACCOUNT_STATEMENT: z.object({}),
    DOWNLOAD_ACCOUNT_STATEMENT: z.object({}),
    TRANSACTION_HISTORY: z.object({}),
    BUY_DATA: z.object({}),
    PURCHASE_DATA: z.object({}),
    DATA_BUNDLE: z.object({}),
    DATA_TOPUP: z.object({}),
    BUY_AIRTIME: z.object({}),
    PURCHASE_AIRTIME: z.object({}),
    AIRTIME_TOPUP: z.object({}),
    AGENT_SELL_CRYPTO_FOR_FIAT: assetAndNetworkSchema,
    AGENT_GET_FIAT_WITH_CRYPTO: assetAndNetworkSchema,
    AGENT_BUY_CRYPTO_WITH_FIAT: assetAndNetworkSchema,
    AGENT_GET_CRYPTO_WITH_FIAT: assetAndNetworkSchema,
    AGENT_BALANCE: z.object({}),
    AGENT_EARNINGS: z.object({}),
} as const satisfies Record<Exclude<Action['class'], 'NO_PREDEFINED_ACTION'>, ZodSchema>;
