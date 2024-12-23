import { z } from 'zod';
import { TokenNames } from '@/resources/web3/tokens';
import { supportedChainSchema } from '@/app/WalletKit/walletKitSchema';

export enum CryptoPayoutOrderStatus {
    PENDING = 1,
    PROCESSING = 2,
    COMPLETE = 3,
    FAILED = -1,
}

export enum CryptoPayoutReasons {
    ONRAMP = 'ONRAMP',
    OFFRAMP_REFUND = 'OFFRAMP_REFUND',
}

export const cryptoPayoutAuthorizationPayloadSchema = z.object({
    reason: z.nativeEnum(CryptoPayoutReasons),
    triggerTransactionId: z.string(),
});

export type CryptoPayoutAuthorizationPayload = z.infer<
    typeof cryptoPayoutAuthorizationPayloadSchema
>;

export const createCryptoPayoutOrderSchema = z.object({
    tokenSymbol: z.enum([TokenNames.USDT, TokenNames.USDC]),
    amount: z.number(),
    destinationWalletAddress: z.string(),
    network: supportedChainSchema,
    triggerTransactionId: z.string(),
    ownerId: z.string().optional(),
});

export type CreateCryptoPayoutOrderParams = z.infer<typeof createCryptoPayoutOrderSchema>;
