import Web3Library from '@/app/WalletAssetManagement/Web3Library';
import { getNetworkEmoji } from '@/resources/utils/bot-message-utils';
import { getAppDefaultEvmConfig } from '@/resources/web3/evm/evm.config';
import { getPublicClient } from '@/resources/web3/evm/viem/clients';
import { CoreToolCallUnion, CoreToolResultUnion, tool, CoreTool } from 'ai';
import { z } from 'zod';
import { createOpenAI } from '@ai-sdk/openai';
import env from '@/constants/env';
import { TokenNames } from '@/resources/web3/tokens';
import { supportedChainSchema } from '@/app/WalletKit/walletKitSchema';
import { ENABLED_ASSETS } from '@/config/whatsAppBot';
import { extendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import {
    baseWalletToolSchema,
    depositCryptoAssetParamsSchema,
    requestTransactionPinSetupParams,
    swapTokensOnBaseParamsSchema,
    swapTokensParamsSchema,
    transferCryptoAssetParamsSchema,
    walletBalanceParamsSchema,
} from '@/app/aiAgent/agent.schema';
import {
    executeChangeTransactionPin,
    executeDepositCryptoAsset,
    executeRequestTransactionPinSetup,
    executeResetTransactionPin,
    executeSwapTokens,
    executeSwapTokensOnBase,
    executeTransferAsset,
    executeWalletBalanceQuery,
} from '@/app/aiAgent/agent.tools-logic';

function getSupportedAssetAndNetworksText() {
    const supportedTokenNames = ENABLED_ASSETS.map((asset) => asset.tokenName);

    const uniqueSupportedTokenNames = Array.from(new Set(supportedTokenNames));

    return uniqueSupportedTokenNames
        .map((tokenName) => {
            const supportedNetworks = ENABLED_ASSETS.filter(
                (asset) => asset.tokenName === tokenName
            ).map((asset) => asset.network);
            return `- ${tokenName}: ${supportedNetworks.join(', ')}`;
        })
        .join('\n');
}

////////////////////
// Agent Toolset
////////////////////
export const toolSet = {
    transferCrypto: tool({
        description: `A transaction tool for transferring a crypto asset to a specified address or phone number. Always confirm with the user the cryptocurrency, amount, recipient, and blockchain network before proceeding. If any of these are missing, ask the user to specify them in one prompt. The recipient can be a wallet address or a phone number`,
        parameters: transferCryptoAssetParamsSchema,
        execute: async (params) => {
            return executeTransferAsset(params);
        },
    }),
    depositCrypto: tool({
        description: `
        Use this tool to handle the user request to deposit a cryptocurrency asset into their wallet. 
        If the cryptocurrency or blockchain network parameters are missing:
        - Respond with a follow-up question that highlights the available assets and networks strictly following the example below.
        - Provide an example to guide the user on how to specify the asset and network.

        Example:
        "Tell me what asset you want to deposit and the chain it’s on.

        Example: “USDT on Solana”

        Supported Assets and Chains:\n
        ${getSupportedAssetAndNetworksText()}
        "
    `,
        parameters: depositCryptoAssetParamsSchema,
        execute: async (params) => {
            return executeDepositCryptoAsset(params);
        },
    }),
    walletBalance: tool({
        description:
            "Retrieve the balance of a user's wallet for a specified cryptocurrency or blockchain network. " +
            'If no cryptocurrency or network is specified, return balances for all supported assets and networks, grouping them as needed by asset and network (only when listing balances for multiple networks). ' +
            'Use the unique emoji provided by the `networkEmoji` parameter in the tool result as a visual identifier for each network following this text arrangement format [emoji] [network]. Never guess or assume the emoji for any network. Also, the format for displaying a crypto asset balance should be [amount] [cryptocurrency symbol] [usd value], e.g 0.5 USDT ($0.5)',
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
    getNetworkSpecificEmoji: tool({
        parameters: z.object({
            blockchainNetwork: supportedChainSchema
                .or(extendedWalletSupportedNetworks)
                .describe('The blockchain network to retrieve the emoji for'),
        }),
        description:
            'Retrieve the unique emoji assigned to a blockchain network. These emojis act as visual identifiers and must precede the network name in messages (e.g., 🔷Ethereum, where 🔷 represents Ethereum). Use the exact emoji provided by this tool to maintain accuracy and consistency. Avoid guessing or assuming the emoji for any network.',
        execute: async ({ blockchainNetwork }) => {
            return getNetworkEmoji(blockchainNetwork);
        },
    }),
    changeTransactionPin: tool({
        parameters: baseWalletToolSchema,
        description: 'Use this tool to handle the user request to change their transaction pin',
        execute: async ({ userId }) => {
            return executeChangeTransactionPin({ userId });
        },
    }),
    resetTransactionPin: tool({
        parameters: baseWalletToolSchema,
        description: 'Use this tool to handle the user request to reset their transaction pin',
        execute: async ({ userId }) => {
            return executeResetTransactionPin({ userId });
        },
    }),
    // swapTokensOnBaseNetwork: tool({
    //     parameters: swapTokensOnBaseParamsSchema,
    //     description:
    //         'This tool defines exclusive support for swapping tokens on Base. Use this tool when a user wants to swap one token for another or buy a token with another one. This functionality is similar to the swapping feature on Dexs like Uniswap.',
    //     execute: async (params) => executeSwapTokensOnBase(params),
    // }),
    // retrieveTokenMetadata: tool({
    //     parameters: z.object({
    //         tokenAddress: z.string().describe('The address of the token to retrieve metadata for'),
    //         blockchainNetwork: supportedChainSchema,
    //     }),
    //     description:
    //         'Use this tool to retrieve metadata for a token on a specified blockchain network. The metadata includes the token name, symbol, and decimals. This tool is useful for displaying token information to the user.',
    //     execute: async ({ tokenAddress, blockchainNetwork }) => {
    //         try {
    //             const networkConfig = getAppDefaultEvmConfig(
    //                 blockchainNetwork,
    //                 env.WEB3_ENVIRONMENT
    //             );
    //             const publicClient = getPublicClient(networkConfig.viemChain, networkConfig.rpcUrl);
    //
    //             return {
    //                 tokenMetadata: await Web3Library.getErc20TokenMetadata(
    //                     publicClient,
    //                     tokenAddress
    //                 ),
    //             };
    //         } catch (error) {
    //             return {
    //                 error: `Please confirm that the token address is correct and that the token is deployed on the ${blockchainNetwork} network.`,
    //             };
    //         }
    //     },
    // }),
    swapTokens: tool({
        parameters: swapTokensParamsSchema,
        execute: async (params) => executeSwapTokens(params),
        description:
            'Use this tool to handle the user request to swap one token for another. Ensure that the user has specified both the from and to tokens for the swap and other parameters. If these are missing, prompt the user to provide them before proceeding.',
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
