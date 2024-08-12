import { BAD_REQUEST, INTERNAL_SERVER_ERROR } from '@/constants/status-codes';
import { dbClient } from '@/Db/dbClient';
import { HttpException } from '@/Resources/exceptions/HttpException';
import env from '@/constants/env';
import {
    CreateWalletKitWalletParams,
    CreateWalletKitWalletResponse,
    SUPPORTED_CHAINS,
} from '@/app/WalletKit/walletKitSchema';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import {
    KycStatus,
    UserAssetInfo,
    UserAssetItem,
    userIdentityInfoSchema,
} from '@/app/User/userSchema';
import { getDummyUsdValue, TokenNames } from '@/Resources/web3/tokens';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { UserRecord } from '@/Db/xata';
import { fixNumber, formatNumberAsCurrency, prettifyNumber } from '@/Resources/utils/currency';
import { THREE } from '@/constants/numbers';
import { ENABLED_ASSETS, getAssetConfigOrThrow } from '@/config/whatsAppBot';
import AlchemyNotifyService from '@/app/AlchemyNotify/AlchemyNotifyService';
import logger from '@/Resources/logger';
import { parseUnknownError } from '@/Resources/requestHelpers/handleRequestError';

class UserService {
    private static USER_TABLE = dbClient.User;

    public static async createUser(phoneNumber: string, displayName: string) {
        try {
            const user = await this.userExists(phoneNumber);

            if (!user) {
                await this.USER_TABLE.create({
                    id: phoneNumber,
                    phoneNumber: phoneNumber,
                });

                return true;
            }

            return false;
        } catch (error) {
            throw new HttpException(INTERNAL_SERVER_ERROR, `User not found`);
        }
    }

    public static async getUserByMessageId(messageId: string) {
        const record = await this.USER_TABLE.filter({ messageId }).getFirst();
        return record;
    }

    public static async markMessageProcessed(messageId: string) {
        const record = await this.getUserByMessageId(messageId);
        if (record) {
            await record.update({ messageId: null });
        }
    }

    public static async userExists(phoneNumber: string) {
        const record = await this.getUserByPhoneNumber(phoneNumber);
        return !!record;
    }

    public static async getUserByPhoneNumber(phoneNumber: string) {
        return await this.USER_TABLE.filter({ phoneNumber }).getFirst();
    }

    public static async updateUserInfoFromKyc(
        user: UserRecord,
        info: Pick<
            UserRecord,
            | 'country'
            | 'firstName'
            | 'kycStatus'
            | 'lastName'
            | 'kycDateOfBirth'
            | 'kycIdType'
            | 'kycDocumentNumber'
        >
    ) {
        try {
            await this.USER_TABLE.update(user.id, info);
        } catch (err) {
            throw new HttpException(INTERNAL_SERVER_ERROR, 'User info not updated!');
        }
    }

    public static async getUserIdentityInfo(phoneNumber: string) {
        const user = await this.getUserByPhoneNumber(phoneNumber);

        if (!user) {
            throw new HttpException(BAD_REQUEST, 'User not found');
        }

        const kycStatus = this.formatKycStatus(user.kycStatus);

        if (kycStatus !== 'verified') {
            return null;
        }

        const validation = userIdentityInfoSchema.safeParse({
            ...user,
            kycStatus,
        });

        if (!validation.success) {
            return null;
        }

        return validation.data;
    }

    public static async updateUserKycStatus(
        user: UserRecord,
        newStatus: 'VERIFIED' | 'IN_REVIEW' | 'REJECTED' | null
    ) {
        try {
            await this.USER_TABLE.update(user.id, { kycStatus: newStatus }, ['kycStatus']);
        } catch (err) {
            throw new HttpException(INTERNAL_SERVER_ERROR, 'KYC status not updated!');
        }
    }

    public static async createUserWallets(phoneNumber: string) {
        const promises = SUPPORTED_CHAINS.map((chain) =>
            this.initializeUserWallet({
                name: `${chain} Wallet`,
                owner_id: phoneNumber,
                network: chain,
                control_mode: 'developer',
                type: 'contract',
                developer_secret: env.WALLET_KIT_DEVELOPER_SECRET,
            })
        );

        return UserService.computeUserWalletAssetsList(await Promise.all(promises));
    }

    public static computeUserWalletAssetsList(
        userWallets: Array<CreateWalletKitWalletResponse>
    ): Array<UserAssetItem> {
        const enabledAssets = userWallets.map((wallet) => {
            const assets = ENABLED_ASSETS.filter((asset) => asset.network === wallet.network);
            return assets.map((asset) => ({
                listItemId: asset.listItemId,
                walletAddress: wallet.address,
                name: asset.tokenName,
                tokenAddress: asset.tokenAddress,
                network: asset.network,
            }));
        });

        return enabledAssets.flat();
    }

    public static async getUserWalletAssetsList(phoneNumber: string) {
        const userWallets = await WalletKitService.getUserWallets(phoneNumber);

        return this.computeUserWalletAssetsList(
            await this.syncUserWalletsWithSupportedChains(phoneNumber, userWallets)
        );
    }

    public static async getUserAssetWalletOrThrow(phoneNumber: string, assetListItemId: string) {
        const assetConfig = getAssetConfigOrThrow(assetListItemId);

        const wallet = await WalletKitService.getUserWalletByNetwork(
            phoneNumber,
            assetConfig.network
        );

        return {
            listItemId: assetConfig.listItemId,
            walletAddress: wallet.address,
            name: assetConfig.tokenName,
            tokenAddress: assetConfig.tokenAddress,
            network: assetConfig.network,
        };
    }

    public static async getUserAssetInfo(
        phoneNumber: string,
        assetListItemId: string
    ): Promise<UserAssetInfo> {
        const assetWallet = await this.getUserAssetWalletOrThrow(phoneNumber, assetListItemId);

        if (!assetWallet) {
            throw new HttpException(BAD_REQUEST, `Asset not found`);
        }

        const tokenBalance = await WalletKitService.getBalance(
            assetWallet.walletAddress,
            assetWallet.network,
            assetWallet.tokenAddress
        );

        const tokenBalanceAsNumber = parseFloat(tokenBalance);
        const usdBalance = getDummyUsdValue(assetWallet.name as TokenNames) * tokenBalanceAsNumber;

        const usdBalanceDisplay = formatNumberAsCurrency(fixNumber(usdBalance, THREE), 'USD');
        const tokenBalanceDisplay = prettifyNumber(tokenBalanceAsNumber, THREE);

        return {
            usdDisplayBalance: usdBalanceDisplay,
            tokenBalance: tokenBalanceDisplay,
            walletAddress: assetWallet.walletAddress,
            listItemId: assetListItemId,
            assetName: assetWallet.name,
            assetNetwork: assetWallet.network,
            tokenAddress: assetWallet.tokenAddress,
        };
    }

    public static async sendUserAssetForOfframp(asset: UserAssetItem, usdAmount: string) {
        const hotWalletAddress = await FiatRampService.getHotWalletForNetwork('evm');

        const transactionResponse = await WalletKitService.transferToken({
            network: asset.network,
            developer_secret: env.WALLET_KIT_DEVELOPER_SECRET,
            from: asset.walletAddress,
            token: asset.tokenAddress,
            recipient: hotWalletAddress,
            amount: usdAmount,
        });

        return { transactionId: transactionResponse.transaction_id, hotWalletAddress };
    }

    public static async processOfframpTransactionInDemoMode(
        onChainTransactionId: string,
        params: {
            beneficiaryId: string;
            usdAmount: string;
            localAmount: string;
            tokenAddress: string;
            hotWalletAddress: string;
            chainName: string;
            tokenName: string;
            userWalletAddress: string;
        }
    ) {
        const transactionDetails = await WalletKitService.getTransactionById(onChainTransactionId);

        if (transactionDetails.status === 'submitted') {
            setTimeout(() => {
                this.processOfframpTransactionInDemoMode(onChainTransactionId, params);
            }, 5000);
        }

        if (transactionDetails.status === 'success' && transactionDetails.transaction_hash) {
            await FiatRampService.postOfframpTransaction({
                usdAmount: Number(params.usdAmount),
                localAmount: Number(params.localAmount),
                txHash: transactionDetails.transaction_hash,
                beneficiaryId: params.beneficiaryId,
                tokenAddress: params.tokenAddress,
                chainName: params.chainName,
                tokenName: params.tokenName,
                userWalletAddress: params.userWalletAddress,
                hotWalletAddress: params.hotWalletAddress,
            });
        }
    }

    public static async getUserKycStatus(phoneNumber: string): Promise<KycStatus> {
        const user = await this.getUserByPhoneNumber(phoneNumber);

        if (!user) {
            throw new HttpException(BAD_REQUEST, 'User not found');
        }

        return this.formatKycStatus(user.kycStatus);
    }

    private static formatKycStatus(kycStatus: string | null | undefined): KycStatus {
        if (!kycStatus?.trim()) {
            return 'unverified';
        }

        switch (kycStatus) {
            case 'VERIFIED':
                return 'verified';
            case 'IN_REVIEW':
                return 'in_review';
            case 'REJECTED':
                return 'rejected';
            default:
                return 'pending';
        }
    }

    private static async initializeUserWallet(params: CreateWalletKitWalletParams) {
        const wallet = await WalletKitService.createUserWallet(params);

        try {
            await AlchemyNotifyService.addWebhookAddresses([wallet.address], wallet.network);
        } catch (error) {
            const parsedError = parseUnknownError(error);

            logger.error('Error adding webhook address', {
                error: JSON.stringify(parsedError, null, 2),
            });
        }

        return wallet;
    }

    public static async syncUserWalletsWithSupportedChains(
        userPhoneNumber: string,
        userWallets: Array<CreateWalletKitWalletResponse>
    ) {
        const promises: Array<Promise<CreateWalletKitWalletResponse>> = [];

        SUPPORTED_CHAINS.forEach((network) => {
            const wallet = userWallets.find((wallet) => wallet.network === network);

            if (!wallet) {
                promises.push(
                    this.initializeUserWallet({
                        network,
                        owner_id: userPhoneNumber,
                        control_mode: 'developer',
                        developer_secret: env.WALLET_KIT_DEVELOPER_SECRET,
                        name: `${network} Wallet`,
                        type: 'contract',
                    })
                );
            } else {
                promises.push(Promise.resolve(wallet));
            }
        });

        const settledPromises = await Promise.allSettled(promises);

        const fulfilledSettlements = settledPromises.filter(
            (settlement) => settlement.status === 'fulfilled'
        ) as Array<PromiseFulfilledResult<CreateWalletKitWalletResponse>>;

        return fulfilledSettlements.map((settlement) => settlement.value);
    }
}

export default UserService;
