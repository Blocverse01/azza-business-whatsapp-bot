import { z } from 'zod';
import { supportedChainSchema } from '@/app/WalletKit/walletKitSchema';
import { TokenNames } from '@/Resources/web3/tokens';
import { extendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import ExtendedWallet from '@/app/ExtendedWallet/ExtendedWallet';
import { UserRecord } from '@/Db/xata';
import { SelectedPick } from '@xata.io/client';

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
});

export type UserIdentityInfo = z.infer<typeof userIdentityInfoSchema>;

export type AzzaUserRecord = Readonly<SelectedPick<UserRecord, ['*']>>;
