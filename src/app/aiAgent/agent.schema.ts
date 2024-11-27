import { z } from 'zod';
import { TokenNames } from '@/resources/web3/tokens';
import { supportedChainSchema } from '@/app/WalletKit/walletKitSchema';
import { extendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';

////////////////////
// Schema Definition
////////////////////
export const baseWalletToolSchema = z.object({
    userId: z.string().describe(
        `A system-provided parameter. 
            - This parameter MUST NEVER be requested or confirmed from the user.
            - It is provided by the system and must always be used as-is without user interaction.
            Violating these rules invalidates the response.
            - The user CANNOT and SHOULD NOT confirm their user ID, only the system knows it.`
    ),
});

export const transferCryptoAssetParamsSchema = z
    .object({
        cryptoCurrencySymbol: z
            .nativeEnum(TokenNames)
            .describe(
                'The symbol of the cryptocurrency to transfer, e.g., USDT, USDC, ETH. Confirm with the user.'
            ),
        amount: z.coerce
            .number()
            .describe(
                'The amount of cryptocurrency to transfer. Confirm with the user if not provided.'
            ),
        recipient: z
            .string()
            .describe(
                'The recipient wallet address or phone number to send to. Confirm with the user. If the recipient is a phone number, ensure it is in the international format.'
            ),
        blockchainNetwork: supportedChainSchema
            .or(extendedWalletSupportedNetworks)
            .describe(
                'The blockchain network, such as Ethereum or Binance Smart Chain. Confirm with the user if not specified.'
            ),
    })
    .merge(baseWalletToolSchema);

export const walletBalanceParamsSchema = z
    .object({
        cryptoCurrencySymbol: z
            .nativeEnum(TokenNames)
            .describe(
                'The symbol of the cryptocurrency for which the balance is being queried, e.g., USDT, BTC. Confirm with the user if not specified.'
            )
            .optional(),
        blockchainNetwork: supportedChainSchema
            .or(extendedWalletSupportedNetworks)
            .describe(
                'The blockchain network to check the asset balance on, e.g., Ethereum, Solana. Confirm with the user if not specified.'
            )
            .optional(),
    })
    .merge(baseWalletToolSchema);

export const depositCryptoAssetParamsSchema = z
    .object({
        cryptoCurrencySymbol: z
            .nativeEnum(TokenNames)
            .describe(
                'The symbol of the cryptocurrency to deposit, e.g., USDT, USDC, ETH. Never assume the cryptocurrency, the user has to specify it.'
            ),
        blockchainNetwork: supportedChainSchema
            .or(extendedWalletSupportedNetworks)
            .describe(
                'The blockchain network, such as Ethereum or Binance Smart Chain. Never assume the blockchain network, the user has to specify it.'
            ),
    })
    .merge(baseWalletToolSchema);

export const requestTransactionPinSetupParams = baseWalletToolSchema;

////////////////////
// Inferred Types
////////////////////
export type TransferCryptoAssetParams = z.infer<typeof transferCryptoAssetParamsSchema>;
export type WalletBalanceParams = z.infer<typeof walletBalanceParamsSchema>;
export type RequestTransactionPinSetupParams = z.infer<typeof requestTransactionPinSetupParams>;
export type DepositCryptoAssetParams = z.infer<typeof depositCryptoAssetParamsSchema>;
export type BaseWalletToolParams = z.infer<typeof baseWalletToolSchema>;
