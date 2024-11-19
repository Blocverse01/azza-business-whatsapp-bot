import { CoreToolCallUnion, CoreToolResultUnion, tool, CoreTool } from 'ai';
import { z } from 'zod';
import { createOpenAI } from '@ai-sdk/openai';
import env from '@/constants/env';
import { TokenNames } from '@/resources/web3/tokens';
import { supportedChainSchema } from '@/app/WalletKit/walletKitSchema';
import { ENABLED_ASSETS } from '@/config/whatsAppBot';
import { extendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import {
    depositCryptoAssetParamsSchema,
    requestTransactionPinSetupParams,
    transferCryptoAssetParamsSchema,
    walletBalanceParamsSchema,
} from '@/app/aiAgent/agent.schema';
import {
    executeDepositCryptoAsset,
    executeRequestTransactionPinSetup,
    executeTransferAsset,
    executeWalletBalanceQuery,
} from '@/app/aiAgent/agent.tools-logic';

////////////////////
// Agent Toolset
////////////////////
export const toolSet = {
    transferCrypto: tool({
        description: `A transaction tool for transferring a crypto asset to a specified address or phone number. Always confirm with the user the cryptocurrency, amount, recipient, and blockchain network before proceeding. If any of these are missing, ask the user to specify them in one prompt.`,
        parameters: transferCryptoAssetParamsSchema,
        execute: async (params) => {
            return executeTransferAsset(params);
        },
    }),
    depositCrypto: tool({
        description:
            'Use this tool to handle the user request to deposit a cryptocurrency asset into their wallet. Ensure that the user has specified the asset and blockchain network for the deposit. If these are missing, prompt the user to provide them before proceeding. The sole purpose of this tool is to respond with the deposit address for the specified asset and network. The response should not include any additional information or instructions.',
        parameters: depositCryptoAssetParamsSchema,
        execute: async (params) => {
            return executeDepositCryptoAsset(params);
        },
    }),
    walletBalance: tool({
        description:
            "Use this tool to check the balance of a user's wallet for a specified cryptocurrency and/or network. " +
            'If the user does not specify a cryptocurrency or blockchain network, we would return the balance for all supported assets and networks.',
        parameters: walletBalanceParamsSchema,
        execute: async (params) => {
            return executeWalletBalanceQuery(params);
        },
    }),
    // buyCrypto: tool({
    //     description:
    //         "Use this tool to handle the user's request to purchase a cryptocurrency asset with a fiat currency. Ensure that the user has specified both the asset and blockchain network for the purchase. " +
    //         'If these are missing, prompt the user to provide them before proceeding.',
    //     parameters: z.object({
    //         cryptoCurrencySymbol: z
    //             .nativeEnum(TokenNames)
    //             .describe(
    //                 'The symbol of the cryptocurrency to buy, e.g., USDT, BTC. Confirm with the user if not specified.'
    //             ),
    //         blockchainNetwork: supportedChainSchema
    //             .or(extendedWalletSupportedNetworks)
    //             .describe(
    //                 'The blockchain network on which the asset is to be purchased, e.g., Ethereum, Binance Smart Chain. Confirm if not specified.'
    //             )
    //             .optional(),
    //     }),
    //     execute: async ({ cryptoCurrencySymbol, blockchainNetwork }) => {
    //         console.log({ cryptoCurrencySymbol, blockchainNetwork });
    //         return {
    //             message: 'Initiating purchase',
    //         };
    //     },
    // }),
    // sellCrypto: tool({
    //     description:
    //         "Use this tool to handle the user's request to sell a cryptocurrency for a fiat currency. Ensure that the user has specified both the asset and blockchain network for the sale. " +
    //         'If these are missing, prompt the user to provide them before proceeding.',
    //     parameters: z.object({
    //         cryptoCurrencySymbol: z
    //             .nativeEnum(TokenNames)
    //             .describe(
    //                 'The symbol of the cryptocurrency to buy, e.g., USDT, BTC. Confirm with the user if not specified.'
    //             ),
    //         blockchainNetwork: supportedChainSchema
    //             .or(extendedWalletSupportedNetworks)
    //             .describe(
    //                 'The blockchain network on which the asset is to be sold, e.g., Ethereum, Binance Smart Chain. Confirm if not specified.'
    //             ),
    //     }),
    //     execute: async ({ cryptoCurrencySymbol, blockchainNetwork }) => {
    //         console.log({ cryptoCurrencySymbol, blockchainNetwork });
    //         return {
    //             message: 'Initiating sale',
    //         };
    //     },
    // }),
    // getFiatRates: tool({
    //     description:
    //         'Use this tool to get the current exchange rates for USD/a target fiat currency',
    //     parameters: z.object({
    //         targetFiatCurrency: z
    //             .string()
    //             .describe('The target fiat currency to get the exchange rates for'),
    //     }),
    //     execute: async ({ targetFiatCurrency }) => {
    //         console.log({ targetFiatCurrency });
    //     },
    // }),
    getSupportedNetworks: tool({
        description: 'Use this tool to get the supported blockchain networks on the wallet',
        execute: async () => {
            const supportedNetworks = ENABLED_ASSETS.map((asset) => asset.network);

            return {
                supportedNetworks,
            };
        },
        parameters: z.object({}),
    }),
    getSupportedAssetsInformation: tool({
        description:
            'Use this tool to get the supported assets on the wallet and the actions supported for each asset',
        execute: async () => {
            return {
                supportedAssets: ENABLED_ASSETS,
            };
        },
        parameters: z.object({}),
    }),
    requestTransactionPinSetup: tool({
        description: `Use this tool when the user is requesting to set a transaction pin. When using this tool you MUST NEVER confirm the 'userId' parameter with the user or ask for the 'userId' parameter from the user. The 'userId' parameter is always a system-provided value and is already taken care of by the system to be dynamic for each user.`,
        parameters: requestTransactionPinSetupParams,
        execute: async (params) => {
            return executeRequestTransactionPinSetup(params);
        },
    }),
} satisfies Record<string, CoreTool>;

export type ToolCall = CoreToolCallUnion<typeof toolSet>;
export type ToolResult = CoreToolResultUnion<typeof toolSet>;

////////////////////
// Model Providers
////////////////////
export const groq = createOpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: env.GROQ_API_KEY,
});

////////////////////
// Models
////////////////////
export const LLAMA3_8B_8192 = 'llama3-8b-8192';
export const LLAMA3_GROQ_70B_8192_TOOL_USE = 'llama3-groq-70b-8192-tool-use-preview';
export const LLAMA3_GROQ_8B_8192_TOOL_USE = 'llama3-groq-8b-8192-tool-use-preview';

////////////////////
// Agent Steps
////////////////////
export const MAX_STEPS = 10;
