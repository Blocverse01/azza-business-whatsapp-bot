import { z } from 'zod';

export const extendedWalletSupportedNetworks = z.enum(['Tron', 'Bep20', 'Solana']);

export const activeExtendedWalletSupportedNetworks = z.enum(['Tron', 'Bep20']);

export type ExtendedWalletSupportedNetworks = z.infer<typeof extendedWalletSupportedNetworks>;

export const extendedWalletIdentitySchema = z.object({
    address: z.string(),
    privateKey: z.string(),
});

export type ExtendedWalletIdentity = z.infer<typeof extendedWalletIdentitySchema>;

export const extendedWalletTransactionSchema = z.object({
    transactionHash: z.string(),
    status: z.enum(['pending', 'failed', 'submitted', 'reverted', 'success']),
    explorerUrl: z.string().url().nullable(),
});

export type ExtendedWalletTransaction = z.infer<typeof extendedWalletTransactionSchema>;

export const devWalletSchema = z.object({
    mnemonic: z.string(),
    address: z.string(),
});

export const transferTransactionResponseSchema = z.object({
    status: z.enum(['success', 'submitted', 'failed', 'pending']),
    transactionHash: z.string(),
});

export type TransferTransactionResponse = z.infer<typeof transferTransactionResponseSchema>;
