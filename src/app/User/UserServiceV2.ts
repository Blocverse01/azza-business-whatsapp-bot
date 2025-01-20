import { type SecurityQuestion } from '@/app/azza/azza.schema';
import { AllSupportedBlockchains } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import { type KycStatus, userIdentityInfoSchema } from '@/app/User/userSchema';
import { ONE } from '@/constants/numbers';
import { BAD_REQUEST } from '@/constants/status-codes';
import type { UserBlockradarWalletRecord, UserV2Record } from '@/db/xata';
import { HttpException } from '@/resources/exceptions/HttpException';
import { EvmNetwork } from '@/resources/web3/evm/evm.config';
import type Redis from 'ioredis';
import type { PhoneNumber } from 'libphonenumber-js/types';

type UpdatableInfo = Pick<
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
        };
    };
    utils: {
        cleanPhoneNumberInput: (phoneNumber: string) => string;
        getPhoneNumberObject: (phoneNumber: string) => PhoneNumber | undefined;
        encryptWithAES: (data: string, key: string, iv: string) => string;
        decryptWithAES: (data: string, key: string, iv: string) => string;
        isEvmNetwork: (network: AllSupportedBlockchains) => network is EvmNetwork;
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
        const existingRecord = await this.getWhatsappUserByPhoneNumber(primaryWAPhoneNumber);

        if (existingRecord) {
            throw new Error('User already exists');
        }

        if (this.cacheStore) {
            await this.cacheStore.del(this.cacheKeys(primaryWAPhoneNumber).user);
        }

        return await this.repository.user.createUser({
            primaryWhatsappPhoneNumber: primaryWAPhoneNumber,
            ...otherInfo,
        });
    }

    public static async getWhatsappUserByPhoneNumber(phoneNumber: string) {
        return await this.repository.user.getUserByWhatsappPhoneNumber(phoneNumber);
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
            await this.setUserCache(cacheKey, updatedUser);
        }

        return updatedUser;
    }

    public static async getWhatsappUserIdentityInfo(identifier: string) {
        const user =
            (await this.getWhatsappUserByPhoneNumber(identifier)) ??
            (await this.getUserById(identifier));

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
            phoneNumber: user.primaryWhatsappPhoneNumber!,
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
            await this.setUserCache(cacheKey, updatedRecord);
        }

        return updatedRecord;
    }

    public static async updateUserTransactionPin(user: UserV2Record, newPinHash: string) {
        const cacheKey = this.cacheKeys(user.id).user;

        const updatedRecord = await this.updateUserInfo(user, {
            transactionPinHash: newPinHash,
        });

        if (updatedRecord) {
            await this.setUserCache(cacheKey, updatedRecord);
        }

        return updatedRecord;
    }

    public static formatKycStatus(kycStatus: string | null | undefined): KycStatus {
        if (!kycStatus?.trim()) {
            return 'unverified';
        }

        switch (kycStatus.trim()) {
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

        return walletConfig.map((wallet) => ({
            addressId: wallet.addressId,
            blockchainNetwork: wallet.blockchainNetwork,
            address: wallet.address,
        })) satisfies Array<UserBlockRadarWallet>;
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
            walle,
            tsToCreate
        );

        if (!walletConfig) {
            return null;
        }

        return walletConfig as Array<UserBlockRadarWallet>;
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
            user: `user-${userId}`,
        };
    }

    private static async setUserCache(cacheId: string, user: UserV2Record) {
        if (this.cacheStore && this.env.enableCache) {
            return this.cacheStore.set(cacheId, JSON.stringify(user));
        }
    }
}

export default UserServiceV2;
