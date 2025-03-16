import ExtendedWallet from '@/app/ExtendedWallet/ExtendedWallet';
import { UserV2Record } from '@/db/xata';
import { supportedBlockchainChainSchema } from '@/resources/web3/core/blockchains';
import { TokenNames } from '@/resources/web3/core/tokens';
import { SelectedPick } from '@xata.io/client';
import { z } from 'zod';

export const userAssetSchema = z.object({
    listItemId: z.string(),
    walletAddress: z.string(),
    name: z.nativeEnum(TokenNames),
    tokenAddress: z.string(),
    network: supportedBlockchainChainSchema,
});

export type UserAssetItem = z.infer<typeof userAssetSchema>;

export const userAssetInfoSchema = z.object({
    usdDisplayBalance: z.string(),
    tokenBalance: z.number(),
    tokenBalanceDisplay: z.string(),
    walletAddress: z.string(),
    listItemId: z.string(),
    assetName: z.nativeEnum(TokenNames),
    assetNetwork: supportedBlockchainChainSchema,
    tokenAddress: z.string(),
    extendedWallet: z.custom<ExtendedWallet>().optional(),
});

export type UserAssetInfo = z.infer<typeof userAssetInfoSchema>;

export const kycStatus = z.enum(['verified', 'in_review', 'unverified', 'rejected', 'pending']);

export type KycStatus = z.infer<typeof kycStatus>;

export const userIdentityInfoSchema = z.object({
    phoneNumber: z.string(),
    kycDocumentNumber: z.string(),
    kycIdType: z.string(),
    kycDateOfBirth: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    address: z.string().nullable().optional(),
    country: z.string(),
    kycStatus: kycStatus,
    additionalKycIdType: z.string().nullable().optional(),
    additionalKycIdNumber: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
});

export type UserIdentityInfo = z.infer<typeof userIdentityInfoSchema>;

export type AzzaUserRecord = Readonly<SelectedPick<UserV2Record, ['*']>>;
