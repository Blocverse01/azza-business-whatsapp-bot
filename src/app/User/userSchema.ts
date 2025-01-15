import ExtendedWallet from '@/app/ExtendedWallet/ExtendedWallet';
import { extendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { supportedChainSchema } from '@/app/WalletKit/walletKitSchema';
import { UserV2Record } from '@/db/xata';
import { TokenNames } from '@/resources/web3/tokens';
import { SelectedPick } from '@xata.io/client';
import { z } from 'zod';

export const userAssetSchema = z.object({
    listItemId: z.string(),
    walletAddress: z.string(),
    name: z.nativeEnum(TokenNames),
    tokenAddress: z.string(),
    network: supportedChainSchema.or(extendedWalletSupportedNetworks),
});

export type UserAssetItem = z.infer<typeof userAssetSchema>;

export const userAssetInfoSchema = z.object({
    usdDisplayBalance: z.string(),
    tokenBalance: z.number(),
    tokenBalanceDisplay: z.string(),
    walletAddress: z.string(),
    listItemId: z.string(),
    assetName: z.nativeEnum(TokenNames),
    assetNetwork: supportedChainSchema.or(extendedWalletSupportedNetworks),
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
    address: z.string().optional(),
    country: z.string(),
    kycStatus: kycStatus,
    additionalKycIdType: z.string().optional(),
    additionalKycIdNumber: z.string().optional(),
});

export type UserIdentityInfo = z.infer<typeof userIdentityInfoSchema>;

export type AzzaUserRecord = Readonly<SelectedPick<UserV2Record, ['*']>>;
