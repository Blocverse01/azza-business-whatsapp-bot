import redis from '@/cache/redis';
import env from '@/constants/env';
import { dbClient } from '@/db/dbClient';
import { decryptWithAES, encryptWithAES } from '@/resources/utils/encryption';
import { cleanPhoneNumberInput, getPhoneNumberObject } from '@/resources/utils/phone-numbers';
import UserServiceV2 from '../User/UserServiceV2';

const userServiceV2 = UserServiceV2.init({
    utils: {
        getPhoneNumberObject: getPhoneNumberObject,
        cleanPhoneNumberInput: cleanPhoneNumberInput,
        encryptWithAES: encryptWithAES,
        decryptWithAES: decryptWithAES,
    },
    repository: {
        user: {
            createUser: (params) => dbClient.user_v2.create(params),
            updateUser: (user, info) => dbClient.user_v2.update(user.id, info),
            getUserByWhatsappPhoneNumber: (phoneNumber) =>
                dbClient.user_v2
                    .filter({
                        $any: {
                            linkedWhatsappPhoneNumbers: { $includes: phoneNumber },
                            primaryWhatsappPhoneNumber: phoneNumber,
                        },
                    })
                    .getFirst(),
            searchUserByWhatsappUserPhoneNumber: (phoneNumber) =>
                dbClient.user_v2
                    .filter({
                        $any: {
                            linkedWhatsappPhoneNumbers: { $includes: { $contains: phoneNumber } },
                            primaryWhatsappPhoneNumber: { $contains: phoneNumber },
                        },
                    })
                    .getFirst(),
            getUserById: (userId) => dbClient.user_v2.read(userId),
        },
        blockradarWallet: {
            getWalletConfig: (userId) =>
                dbClient.user_blockradar_wallet_config
                    .select(['wallets'])
                    .filter({
                        user: userId,
                    })
                    .getFirst(),
            createWalletConfig: (userId, wallets) =>
                dbClient.user_blockradar_wallet_config.create({ user: userId, wallets }),
        },
    },
    cacheStore: redis,
    env: {
        securityQuestionsMaskKey: env.SECURITY_QUESTIONS_MASK_KEY,
        securityQuestionsMaskIV: env.SECURITY_QUESTIONS_MASK_IV,
        enableCache: false,
    },
});

export default userServiceV2;
