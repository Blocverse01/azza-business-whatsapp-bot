import { BAD_REQUEST, INTERNAL_SERVER_ERROR } from '@/constants/status-codes';
import { dbClient } from '@/Db/dbClient';
import { HttpException } from '@/Resources/exceptions/HttpException';
import {
    CreateWalletKitWalletParams,
    CreateWalletKitWalletResponse,
    SUPPORTED_CHAINS,
    SupportedChain,
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
import ExtendedWallet from '@/app/ExtendedWallet/ExtendedWallet';
import ExtendedTronWallet from '@/app/ExtendedWallet/tron/ExtendedTronWallet';
import { isExtendedNetwork } from '@/app/ExtendedWallet/utils';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { validateWalletAddress } from '@/Resources/utils/validators';

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
                developer_secret: WalletKitService.DEVELOPER_SECRET,
            })
        );

        return UserService.computeUserWalletAssetsList(await Promise.all(promises));
    }

    public static computeUserWalletAssetsList(
        userWallets: Array<CreateWalletKitWalletResponse | ExtendedWallet>
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

    public static async getExtendedWallet(
        userPhoneNumber: string,
        network: ExtendedWalletSupportedNetworks
    ): Promise<ExtendedWallet> {
        const mnemonic = await this.getMnemonicForExtendedWallet(userPhoneNumber);

        switch (network) {
            case 'Tron':
                return new ExtendedTronWallet(mnemonic);
            default:
                throw new Error('Supported not added yet');
        }
    }

    public static async getUserAssetWalletOrThrow(phoneNumber: string, assetListItemId: string) {
        const assetConfig = getAssetConfigOrThrow(assetListItemId);

        if (isExtendedNetwork(assetConfig.network)) {
            const extendedWallet = await this.getExtendedWallet(phoneNumber, assetConfig.network);

            return {
                listItemId: assetConfig.listItemId,
                walletAddress: extendedWallet.address,
                name: assetConfig.tokenName,
                tokenAddress: assetConfig.tokenAddress,
                network: assetConfig.network,
                extendedWallet,
            };
        }

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

        let tokenBalanceAsNumber: number;

        if (assetWallet.extendedWallet) {
            tokenBalanceAsNumber = await assetWallet.extendedWallet.getWalletTokenBalance(
                assetWallet.tokenAddress
            );
        } else {
            const tokenBalance = await WalletKitService.getBalance(
                assetWallet.walletAddress,
                assetWallet.network,
                assetWallet.tokenAddress
            );
            tokenBalanceAsNumber = parseFloat(tokenBalance);
        }

        const usdBalance = getDummyUsdValue(assetWallet.name as TokenNames) * tokenBalanceAsNumber;

        const usdBalanceDisplay = formatNumberAsCurrency(fixNumber(usdBalance, THREE), 'USD');
        const tokenBalanceDisplay = prettifyNumber(tokenBalanceAsNumber, THREE);

        return {
            tokenBalanceDisplay,
            usdDisplayBalance: usdBalanceDisplay,
            tokenBalance: tokenBalanceAsNumber,
            walletAddress: assetWallet.walletAddress,
            listItemId: assetListItemId,
            assetName: assetWallet.name,
            assetNetwork: assetWallet.network,
            tokenAddress: assetWallet.tokenAddress,
            extendedWallet: assetWallet.extendedWallet,
        };
    }

    public static async sendUserAssetForOfframp(asset: UserAssetInfo, usdAmount: string) {
        const hotWalletAddress = await FiatRampService.getHotWalletForNetwork('evm');

        if (!validateWalletAddress(hotWalletAddress, asset.assetNetwork)) {
            throw new Error('Hot wallet address is invalid');
        }

        if (isExtendedNetwork(asset.assetNetwork)) {
            // TODO: get hot wallet address for non-EVM chains
            const transactionResponse = await asset.extendedWallet!.transferToken(
                asset.tokenAddress,
                Number(usdAmount),
                hotWalletAddress
            );

            return { transactionId: transactionResponse.transactionHash, hotWalletAddress };
        }

        const transactionResponse = await WalletKitService.transferToken({
            network: asset.assetNetwork,
            developer_secret: WalletKitService.DEVELOPER_SECRET,
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
        userWallets: Array<CreateWalletKitWalletResponse | ExtendedWallet>
    ) {
        const promises: Array<Promise<CreateWalletKitWalletResponse | ExtendedWallet>> = [];
        const mnemonic = await this.getMnemonicForExtendedWallet(userPhoneNumber);

        SUPPORTED_CHAINS.forEach((network) => {
            const wallet = userWallets.find((wallet) => wallet.network === network);

            if (!wallet) {
                promises.push(
                    this.initializeUserWallet({
                        network,
                        owner_id: userPhoneNumber,
                        control_mode: 'developer',
                        developer_secret: WalletKitService.DEVELOPER_SECRET,
                        name: `${network} Wallet`,
                        type: 'contract',
                    })
                );
            } else {
                promises.push(Promise.resolve(wallet));
            }
        });

        // Add Tron Extended Wallet
        promises.push(Promise.resolve(new ExtendedTronWallet(mnemonic)));

        const settledPromises = await Promise.allSettled(promises);

        const fulfilledSettlements = settledPromises.filter(
            (settlement) => settlement.status === 'fulfilled'
        ) as Array<PromiseFulfilledResult<CreateWalletKitWalletResponse | ExtendedWallet>>;

        return fulfilledSettlements.map((settlement) => settlement.value);
    }

    private static async getMnemonicForExtendedWallet(phoneNumber: string) {
        const network: SupportedChain = 'Ethereum'; // This should never change once set, else a different mnemonic will be generated

        const wallet = await WalletKitService.getUserWalletByNetwork(phoneNumber, network);

        const walletIdentity = await WalletKitService.exportWallet({
            network: wallet.network,
            address: wallet.address,
            developer_secret: WalletKitService.DEVELOPER_SECRET,
        });

        return walletIdentity.mnemonic_phrase;
    }
}

export default UserService;
