import { SecurityQuestion } from '@/app/azza/azza.schema';
import env from '@/constants/env';
import { BAD_REQUEST, INTERNAL_SERVER_ERROR } from '@/constants/status-codes';
import { dbClient } from '@/db/dbClient';
import { HttpException } from '@/resources/exceptions/HttpException';
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
import { decryptWithAES, encryptWithAES } from '@/resources/utils/encryption';
import { hashString } from '@/resources/utils/hashing';
import { getDummyUsdValue, TokenNames } from '@/resources/web3/tokens';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { UserRecord } from '@/db/xata';
import { fixNumber, formatNumberAsCurrency, prettifyNumber } from '@/resources/utils/currency';
import { ONE, SIX } from '@/constants/numbers';
import { ENABLED_ASSETS, getAssetConfigOrThrow } from '@/config/whatsAppBot';
import AlchemyNotifyService from '@/app/AlchemyNotify/AlchemyNotifyService';
import { logSync } from '@/resources/logger';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import ExtendedWallet from '@/app/ExtendedWallet/ExtendedWallet';
import ExtendedTronWallet from '@/app/ExtendedWallet/tron/ExtendedTronWallet';
import { isExtendedNetwork } from '@/app/ExtendedWallet/utils';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { validateWalletAddress } from '@/resources/utils/validators';
import ExtendedSolanaWallet from '@/app/ExtendedWallet/solana/ExtendedSolanaWallet';
import { getPhoneNumberObject, cleanPhoneNumberInput } from '@/resources/utils/phone-numbers';
import { getWebhookId, isChainWithNotifySupport } from '@/app/AlchemyNotify/config';

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

                await this.createUserWallets(phoneNumber);

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

    /**
     * Search for a user by phone number
     * @param phoneNumber
     * @description The phone number string can be in any of the following formats:
     * - +2341234567890
     * - +23401234567890
     * - 1234567890
     * - 2341234567890
     */
    public static async searchUserByPhoneNumber(phoneNumber: string) {
        const existingUserRecord = await this.USER_TABLE.filter({
            phoneNumber: {
                $contains: phoneNumber,
            },
        }).getFirst();

        if (!existingUserRecord?.phoneNumber) {
            return null;
        }
        const dbRecordPhoneNumberObject = getPhoneNumberObject(existingUserRecord.phoneNumber);

        if (!dbRecordPhoneNumberObject?.countryCallingCode) {
            return null;
        }

        const countryCallingCode = dbRecordPhoneNumberObject.countryCallingCode;
        const cleanPhoneNumber = cleanPhoneNumberInput(phoneNumber);
        const extractedPhoneNumber = cleanPhoneNumber.startsWith(countryCallingCode)
            ? cleanPhoneNumber.split(countryCallingCode)[ONE]
            : cleanPhoneNumber;
        const concatenatedPhoneNumber = `${countryCallingCode}${extractedPhoneNumber}`;

        const userInputPhoneNumberObject = getPhoneNumberObject(concatenatedPhoneNumber);

        if (!userInputPhoneNumberObject) {
            return null;
        }

        if (
            cleanPhoneNumberInput(userInputPhoneNumberObject.number) !==
            cleanPhoneNumberInput(dbRecordPhoneNumberObject.number)
        ) {
            return null;
        }

        return existingUserRecord;
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

    public static async storeNewTransactionPin(
        user: UserRecord,
        newPin: string,
        securityQuestionsSetup: Array<SecurityQuestion>
    ) {
        const hashedPin = await hashString(newPin);
        const encryptedSecuritySetup = this.maskUserSecurityQuestions(securityQuestionsSetup);

        return await this.USER_TABLE.update(
            user.id,
            { transactionPinHash: hashedPin, securityQuestionsSetup: encryptedSecuritySetup },
            ['transactionPinHash', 'securityQuestionsSetup']
        );
    }

    public static async updateTransactionPin(user: UserRecord, newPin: string) {
        const hashedPin = await hashString(newPin);

        return await this.USER_TABLE.update(user.id, { transactionPinHash: hashedPin }, [
            'transactionPinHash',
        ]);
    }

    public static async createUserWallets(phoneNumber: string) {
        const promises = SUPPORTED_CHAINS.map((chain) =>
            this.initializeUserWallet({
                name: `${chain} Wallet`,
                owner_id: phoneNumber,
                network: chain,
                control_mode: 'developer',
                ...(chain === 'Solana' ? {} : { type: 'contract' }),
                developer_secret: WalletKitService.DEVELOPER_SECRET,
            })
        );

        return UserService.computeUserWalletAssetsList(await Promise.all(promises));
    }

    public static computeUserWalletAssetsList(
        userWallets: Array<CreateWalletKitWalletResponse | ExtendedWallet>
    ): Array<UserAssetItem> {
        const enabledAssets = userWallets.map((wallet) => {
            const assets = ENABLED_ASSETS.filter((asset) => {
                return asset.network === wallet.network && asset.showOnAssetsMenu;
            });
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
            // case 'Solana':
            //     return new ExtendedSolanaWallet(mnemonic);
            default:
                throw new Error(`Extended wallet implementation for: ${network} not added yet`);
        }
    }

    public static async getUserAssetWalletOrThrow(phoneNumber: string, assetListItemId: string) {
        const assetConfig = getAssetConfigOrThrow(assetListItemId);

        if (isExtendedNetwork(assetConfig.network)) {
            const extendedWallet = await this.getExtendedWallet(phoneNumber, assetConfig.network);

            return {
                listItemId: assetConfig.listItemId,
                walletAddress: extendedWallet.address,
                name: assetConfig.tokenName as TokenNames,
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
            name: assetConfig.tokenName as TokenNames,
            tokenAddress: assetConfig.tokenAddress,
            network: assetConfig.network,
        };
    }

    public static async getUserAssetInfo(
        phoneNumber: string,
        assetListItemId: string
    ): Promise<UserAssetInfo> {
        const assetConfig = getAssetConfigOrThrow(assetListItemId);
        const assetWallet = await this.getUserAssetWalletOrThrow(phoneNumber, assetListItemId);

        if (!assetWallet) {
            throw new HttpException(BAD_REQUEST, `Asset not found`);
        }

        let tokenBalanceAsNumber: number;

        if (assetWallet.extendedWallet) {
            tokenBalanceAsNumber = assetConfig.isNative
                ? await assetWallet.extendedWallet.getWalletNativeBalance()
                : await assetWallet.extendedWallet.getWalletTokenBalance(assetWallet.tokenAddress);
        } else {
            const tokenBalance = await WalletKitService.getBalance(
                assetWallet.walletAddress,
                assetWallet.network,
                assetWallet.tokenAddress
            );
            tokenBalanceAsNumber = parseFloat(tokenBalance);
        }

        const usdBalance = getDummyUsdValue(assetWallet.name as TokenNames) * tokenBalanceAsNumber;

        const usdBalanceDisplay = formatNumberAsCurrency(fixNumber(usdBalance, SIX), 'USD');
        const tokenBalanceDisplay = prettifyNumber(tokenBalanceAsNumber, SIX);

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

    public static async getUserKycStatus(phoneNumber: string): Promise<KycStatus> {
        const user = await this.getUserByPhoneNumber(phoneNumber);

        if (!user) {
            throw new HttpException(BAD_REQUEST, 'User not found');
        }

        return this.formatKycStatus(user.kycStatus);
    }

    public static async syncUserWalletsWithSupportedChains(
        userPhoneNumber: string,
        userWallets: Array<CreateWalletKitWalletResponse | ExtendedWallet>
    ) {
        const promises: Array<Promise<CreateWalletKitWalletResponse | ExtendedWallet>> = [];

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

        const settledPromises = await Promise.allSettled(promises); // Sync wallet kit wallets
        const fulfilledSettlements = settledPromises.filter(
            (settlement) => settlement.status === 'fulfilled'
        ) as Array<PromiseFulfilledResult<CreateWalletKitWalletResponse | ExtendedWallet>>;
        const availableWallets = fulfilledSettlements.map((settlement) => settlement.value);

        const mnemonic = await this.getMnemonicForExtendedWallet(userPhoneNumber);

        // Add Tron Extended Wallet
        availableWallets.push(new ExtendedTronWallet(mnemonic));
        // availableWallets.push(new ExtendedSolanaWallet(mnemonic));
        // TODO: add other extended wallets

        return availableWallets;
    }

    private static maskUserSecurityQuestions(securityQuestionsSetup: Array<SecurityQuestion>) {
        return encryptWithAES(
            JSON.stringify(securityQuestionsSetup),
            env.SECURITY_QUESTIONS_MASK_KEY,
            env.SECURITY_QUESTIONS_MASK_IV
        );
    }

    public static scoreUserSecurityQuestionsAnswers(
        user: UserRecord,
        answers: Array<{
            questionId: string;
            providedAnswer: string;
        }>
    ) {
        if (!user.securityQuestionsSetup) {
            return {};
        }

        const userSecurityQuestions = this.unmaskUserSecurityQuestions(user.securityQuestionsSetup);

        const scoreSheet: Record<string, boolean> = {};

        userSecurityQuestions.forEach((question, index) => {
            const targetAnswer = answers.find(
                (answer) => answer.questionId === question.immutableId
            );

            if (!targetAnswer) {
                scoreSheet[question.immutableId] = false;
            } else {
                scoreSheet[question.immutableId] =
                    question.answer?.trim().toLowerCase() ===
                    targetAnswer.providedAnswer?.trim().toLowerCase();
            }
        });

        return scoreSheet;
    }

    public static retrieveUserSecurityQuestions(
        user: UserRecord
    ): Array<Pick<SecurityQuestion, 'question' | 'immutableId'>> {
        if (!user.securityQuestionsSetup) {
            return [];
        }

        const unmaskedSecurityQuestions = this.unmaskUserSecurityQuestions(
            user.securityQuestionsSetup
        );

        return unmaskedSecurityQuestions.map((question) => ({
            immutableId: question.immutableId,
            question: question.question,
        }));
    }

    private static unmaskUserSecurityQuestions(encryptedSecuritySetup: string) {
        return JSON.parse(
            decryptWithAES(
                encryptedSecuritySetup,
                env.SECURITY_QUESTIONS_MASK_KEY,
                env.SECURITY_QUESTIONS_MASK_IV
            )
        ) as Array<SecurityQuestion>;
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

        if (!isChainWithNotifySupport(wallet.network)) {
            return wallet;
        }

        const webhookId = getWebhookId(wallet.network);

        try {
            if (webhookId !== '') {
                await AlchemyNotifyService.addWebhookAddresses([wallet.address], webhookId);
            }
        } catch (error) {
            const parsedError = parseUnknownError(error);

            logSync('error', 'Error adding webhook address', {
                error: JSON.stringify(parsedError, null, 2),
            });
        }

        return wallet;
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
