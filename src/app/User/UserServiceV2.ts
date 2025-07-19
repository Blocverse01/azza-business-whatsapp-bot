import { type SecurityQuestion } from '@/app/azza/azza.schema';
import { type KycStatus, userIdentityInfoSchema } from '@/app/User/userSchema';
import { ONE } from '@/constants/numbers';
import { BAD_REQUEST } from '@/constants/status-codes';
import type { UserBlockradarWalletRecord, UserV2Record } from '@/db/xata';
import { HttpException } from '@/resources/exceptions/HttpException';
import {
    AllSupportedBlockchains,
    EvmCompatibleBlockchain,
} from '@/resources/web3/core/blockchains';
import type Redis from 'ioredis';
import type { PhoneNumber } from 'libphonenumber-js';

export type UpdatableInfo = Pick<
    UserV2Record,
    | 'country'
    | 'firstName'
    | 'kycStatus'
    | 'lastName'
    | 'kycDateOfBirth'
    | 'kycIdType'
    | 'kycDocumentNumber'
    | 'linkedWhatsappPhoneNumbers'
    | 'primaryWhatsappPhoneNumber'
    | 'transactionPinHash'
    | 'securityQuestionsSetup'
    | 'additionalKycIdType'
    | 'additionalKycIdNumber'
    | 'gender'
    | 'email'
    | 'address'
>;

type UserBlockRadarWallet = {
    addressId: string;
    blockchainNetwork: string;
    address: string;
};

type UserServiceV2InitParams = {
    cacheStore: Redis;
    repository: {
        user: {
            createUser: (params: UpdatableInfo) => Promise<UserV2Record>;
            getUserByWhatsappPhoneNumber: (phoneNumber: string) => Promise<UserV2Record | null>;
            searchUserByWhatsappUserPhoneNumber: (
                phoneNumber: string
            ) => Promise<UserV2Record | null>;
            updateUser: (
                user: UserV2Record,
                params: Partial<UpdatableInfo>
            ) => Promise<UserV2Record | null>;
            getUserById: (userId: string) => Promise<UserV2Record | null>;
        };
        blockradarWallet: {
            getWalletConfig: (
                userId: string
            ) => Promise<Array<Omit<UserBlockradarWalletRecord, 'user'>>>;
            createWalletConfig: (
                userId: string,
                wallets: Array<UserBlockRadarWallet>
            ) => Promise<Array<Omit<UserBlockradarWalletRecord, 'user'>>>;
            getWalletConfigByWalletAddress: (
                walletAddress: string
            ) => Promise<UserBlockradarWalletRecord | null>
        };
    };
    utils: {
        cleanPhoneNumberInput: (phoneNumber: string) => string;
        getPhoneNumberObject: (phoneNumber: string) => PhoneNumber | undefined;
        encryptWithAES: (data: string, key: string, iv: string) => string;
        decryptWithAES: (data: string, key: string, iv: string) => string;
        isEvmNetwork: (network: AllSupportedBlockchains) => network is EvmCompatibleBlockchain;
    };
    env: {
        securityQuestionsMaskKey: string;
        securityQuestionsMaskIV: string;
        enableCache: boolean;
    };
};

class UserServiceV2 {
    private static repository: UserServiceV2InitParams['repository'];
    private static cacheStore: Redis;
    private static utils: UserServiceV2InitParams['utils'];
    private static env: UserServiceV2InitParams['env'];

    public static init(params: UserServiceV2InitParams) {
        this.cacheStore = params.cacheStore;
        this.repository = params.repository;
        this.utils = params.utils;
        this.env = params.env;

        return this;
    }

    public static async createWhatsappUser(
        primaryWAPhoneNumber: string,
        otherInfo?: Omit<UpdatableInfo, 'primaryWhatsappPhoneNumber'>
    ) {
        const existingRecord = await this.getWhatsappUserByPhoneNumber(primaryWAPhoneNumber, {
            omitCache: true,
        });

        if (existingRecord) {
            return existingRecord;
        }

        return await this.repository.user.createUser({
            primaryWhatsappPhoneNumber: primaryWAPhoneNumber,
            ...otherInfo,
        });
    }

    public static async getWhatsappUserByPhoneNumber(
        phoneNumber: string,
        options: {
            omitCache?: boolean;
        } = {}
    ) {
        const cacheKey = this.cacheKeys(phoneNumber).userIdForPhoneNumber;

        if (options.omitCache !== true && this.cacheStore && this.env.enableCache) {
            const cachedUserId = await this.cacheStore.get(cacheKey);

            if (cachedUserId?.trim()) {
                return await this.getUserById(cachedUserId);
            }
        }

        try {
            const user = await this.repository.user.getUserByWhatsappPhoneNumber(phoneNumber);

            if (user && this.cacheStore && this.env.enableCache) {
                await this.cacheStore.set(cacheKey, user.id);
            }

            return user;
        } catch (error) {
            console.log('Error fetching user', error);
            throw error;
        }
    }

    public static async getUserById(userId: string) {
        const cacheKey = this.cacheKeys(userId).user;

        if (this.cacheStore && this.env.enableCache) {
            const cachedUser = await this.cacheStore.get(this.cacheKeys(userId).user);

            if (cachedUser) {
                return JSON.parse(cachedUser) as UserV2Record;
            }
        }

        const user = await this.repository.user.getUserById(userId);

        if (user) {
            await this.setUserCache(cacheKey, user);
        }

        return user;
    }

    public static async getUserPhoneNumber(userId: string) {
        const user = await this.getUserById(userId);
        const userPhoneNumber = user?.primaryWhatsappPhoneNumber!;
        return userPhoneNumber;
    }

    public static async searchWhatsappUserByPhoneNumber(phoneNumber: string) {
        const existingUserRecord =
            await this.repository.user.searchUserByWhatsappUserPhoneNumber(phoneNumber);

        if (
            !existingUserRecord?.primaryWhatsappPhoneNumber &&
            !existingUserRecord?.linkedWhatsappPhoneNumbers
        ) {
            return null;
        }

        const whatsappPhoneNumbers = [
            existingUserRecord.primaryWhatsappPhoneNumber,
            ...(existingUserRecord.linkedWhatsappPhoneNumbers
                ? existingUserRecord.linkedWhatsappPhoneNumbers
                : []),
        ];

        const targetPhoneNumber = whatsappPhoneNumbers.find((phone) => {
            const dbRecordPhoneNumberObject = this.utils.getPhoneNumberObject(phone);
            if (!dbRecordPhoneNumberObject?.countryCallingCode) {
                return false;
            }

            const countryCallingCode = dbRecordPhoneNumberObject.countryCallingCode;
            const cleanPhoneNumber = this.utils.cleanPhoneNumberInput(phoneNumber);
            const extractedPhoneNumber = cleanPhoneNumber.startsWith(countryCallingCode)
                ? cleanPhoneNumber.split(countryCallingCode)[ONE]
                : cleanPhoneNumber;
            const concatenatedPhoneNumber = `${countryCallingCode}${extractedPhoneNumber}`;

            const userInputPhoneNumberObject =
                this.utils.getPhoneNumberObject(concatenatedPhoneNumber);
            if (!userInputPhoneNumberObject) {
                return false;
            }

            return (
                this.utils.cleanPhoneNumberInput(dbRecordPhoneNumberObject.number) ===
                this.utils.cleanPhoneNumberInput(userInputPhoneNumberObject.number)
            );
        });

        if (!targetPhoneNumber) {
            return null;
        }

        return existingUserRecord;
    }

    public static async updateUserInfo(user: UserV2Record, newInfo: Partial<UpdatableInfo>) {
        const cacheKey = this.cacheKeys(user.id).user;
        const updatedUser = await this.repository.user.updateUser(user, newInfo);

        if (updatedUser) {
            await this.deleteUserCache(cacheKey);
        }

        return updatedUser;
    }

    public static async getWhatsappUserIdentityInfo(identifier: string) {
        let user = await this.getUserById(identifier);

        if (!user) {
            user = await this.getWhatsappUserByPhoneNumber(identifier, {
                omitCache: true,
            });
        }

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
            phoneNumber: user.primaryWhatsappPhoneNumber,
        });

        if (!validation.success) {
            return null;
        }

        return validation.data;
    }

    public static async getWhatsappUserKycStatus(phoneNumber: string): Promise<KycStatus> {
        const user = await this.getWhatsappUserByPhoneNumber(phoneNumber);

        if (!user) {
            throw new HttpException(BAD_REQUEST, 'User not found');
        }

        return this.formatKycStatus(user.kycStatus);
    }

    public static async storeUserTransactionPin(
        user: UserV2Record,
        newPinHash: string,
        encryptedSecurityQuestions: string
    ) {
        const cacheKey = this.cacheKeys(user.id).user;

        const updatedRecord = await this.updateUserInfo(user, {
            transactionPinHash: newPinHash,
            securityQuestionsSetup: encryptedSecurityQuestions,
        });

        if (updatedRecord) {
            await this.deleteUserCache(cacheKey);
        }

        return updatedRecord;
    }

    public static async updateUserTransactionPin(user: UserV2Record, newPinHash: string) {
        const cacheKey = this.cacheKeys(user.id).user;

        const updatedRecord = await this.updateUserInfo(user, {
            transactionPinHash: newPinHash,
        });

        if (updatedRecord) {
            await this.deleteUserCache(cacheKey);
        }

        return updatedRecord;
    }

    public static formatKycStatus(kycStatus: string | null | undefined): KycStatus {
        if (!kycStatus?.trim()) {
            return 'unverified';
        }

        const formattedStatus = kycStatus.trim().toUpperCase();

        switch (formattedStatus) {
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

    public static maskUserSecurityQuestions(securityQuestionsSetup: Array<SecurityQuestion>) {
        return this.utils.encryptWithAES(
            JSON.stringify(securityQuestionsSetup),
            this.env.securityQuestionsMaskKey,
            this.env.securityQuestionsMaskIV
        );
    }

    public static scoreUserSecurityQuestionsAnswers(
        user: UserV2Record,
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

        userSecurityQuestions.forEach((question) => {
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
        user: UserV2Record
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

    public static async getUserBlockradarWallets(userId: string) {
        const walletConfig = await this.repository.blockradarWallet.getWalletConfig(userId);

        if (!walletConfig) {
            return null;
        }

        return walletConfig satisfies Array<UserBlockRadarWallet>;
    }


    public static async getUserBlockradarWalletByAddress(walletAddress: string) {
        const userWalletConfig = await this.repository.blockradarWallet.getWalletConfigByWalletAddress(walletAddress);

        if (!userWalletConfig) {
            return null;
        }

        return userWalletConfig;
    }

    public static async getUserBlockradarWalletAddressId(userId: string, network: string) {
        const wallets = await this.getUserBlockradarWallets(userId);

        const formattedNetwork = this.utils.isEvmNetwork(network as AllSupportedBlockchains)
            ? 'EVM'
            : network.toUpperCase();

        return (
            wallets?.find((wallet) => wallet.blockchainNetwork.toUpperCase() === formattedNetwork)
                ?.addressId ?? null
        );
    }

    public static async createUserBlockradarWalletConfig(
        userId: string,
        wallets: Array<UserBlockRadarWallet>
    ) {
        const evmWallet = wallets.find((wallet) =>
            this.utils.isEvmNetwork(wallet.blockchainNetwork as AllSupportedBlockchains)
        );
        const otherWallets = wallets
            .filter(
                (wallet) =>
                    !this.utils.isEvmNetwork(wallet.blockchainNetwork as AllSupportedBlockchains)
            )
            .map((wallet) => ({
                ...wallet,
                blockchainNetwork: wallet.blockchainNetwork.toUpperCase(),
            }));

        const walletsToCreate = evmWallet
            ? [
                {
                    ...evmWallet,
                    blockchainNetwork: 'EVM',
                },
                ...otherWallets,
            ]
            : otherWallets;

        const walletConfig = await this.repository.blockradarWallet.createWalletConfig(
            userId,
            walletsToCreate
        );

        if (!walletConfig) {
            return null;
        }

        return walletConfig as Array<UserBlockRadarWallet>;
    }

    public static async createUserBlockradarWallet(userId: string, wallet: UserBlockRadarWallet) {
        const existingAddressId = await this.getUserBlockradarWalletAddressId(
            userId,
            wallet.blockchainNetwork
        );

        if (existingAddressId) return;

        return await this.createUserBlockradarWalletConfig(userId, [wallet]);
    }

    private static unmaskUserSecurityQuestions(encryptedSecuritySetup: string) {
        return JSON.parse(
            this.utils.decryptWithAES(
                encryptedSecuritySetup,
                this.env.securityQuestionsMaskKey,
                this.env.securityQuestionsMaskIV
            )
        ) as Array<SecurityQuestion>;
    }

    private static cacheKeys(userId: string) {
        return {
            user: `cache-user-${userId}`,
            wallets: `cache-wallets-${userId}`,
            userIdForPhoneNumber: `cache-user-id-${userId}`,
        };
    }

    private static async setUserCache(cacheId: string, user: UserV2Record) {
        if (this.cacheStore && this.env.enableCache) {
            return this.cacheStore.set(cacheId, JSON.stringify(user));
        }
    }

    private static async deleteUserCache(cacheId: string) {
        if (this.cacheStore && this.env.enableCache) {
            return this.cacheStore.del(cacheId);
        }
    }
}

export default UserServiceV2;
