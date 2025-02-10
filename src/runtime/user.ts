import redis from '@/cache/redis';
import env from '@/constants/env';
import { dbClient } from '@/db/dbClient';
import { decryptWithAES, encryptWithAES } from '@/resources/utils/encryption';
import { cleanPhoneNumberInput, getPhoneNumberObject } from '@/resources/utils/phone-numbers';
import { isEvmCompatibleBlockchain } from '@/resources/web3/core/blockchains';
import UserServiceV2 from '../app/User/UserServiceV2';

const userServiceV2 = UserServiceV2.init({
    utils: {
        getPhoneNumberObject: getPhoneNumberObject,
        cleanPhoneNumberInput: cleanPhoneNumberInput,
        encryptWithAES: encryptWithAES,
        decryptWithAES: decryptWithAES,
        isEvmNetwork: isEvmCompatibleBlockchain,
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
                dbClient.user_blockradar_wallet
                    .select(['*'])
                    .filter({
                        user: userId,
                    })
                    .getAll(),
            createWalletConfig: (userId, wallets) =>
                dbClient.user_blockradar_wallet.create(
                    wallets.map((wallet) => ({
                        user: userId,
                        ...wallet,
                    }))
                ),
        },
    },
    cacheStore: redis,
    env: {
        securityQuestionsMaskKey: env.SECURITY_QUESTIONS_MASK_KEY,
        securityQuestionsMaskIV: env.SECURITY_QUESTIONS_MASK_IV,
        enableCache: true,
    },
});

export default userServiceV2;
