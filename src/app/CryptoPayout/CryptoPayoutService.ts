import { dbClient } from '@/Db/dbClient';
import {
    CreateCryptoPayoutOrderParams,
    CryptoPayoutAuthorizationPayload,
    cryptoPayoutAuthorizationPayloadSchema,
    CryptoPayoutOrderStatus,
    CryptoPayoutReasons,
} from '@/app/CryptoPayout/cryptoPayoutSchema';
import {
    convertBase64ToAsciiString,
    decryptWithPrivateKey,
    encryptWithPublicKey,
} from '@/Resources/utils/encryption';
import env from '@/constants/env';
import FiatRampService from '@/app/FiatRamp/FiatRampService';

class CryptoPayoutService {
    private static cryptoPayoutOrderRepository = dbClient.CryptoPayoutOrder;

    private static generateOnrampCryptoPayoutOrderReference(onrampTransactionId: string) {
        const cryptoPayoutTrigger = {
            reason: CryptoPayoutReasons.ONRAMP,
            triggerTransactionId: onrampTransactionId,
        } satisfies CryptoPayoutAuthorizationPayload;

        return encryptWithPublicKey(
            JSON.stringify(cryptoPayoutTrigger),
            convertBase64ToAsciiString(env.CRYPTO_PAYOUT_AUTHORIZER_PUBLIC_KEY)
        );
    }

    public static validateCryptoPayoutAuthorizationPayload(encryptedPayload: string) {
        const decryptedPayload = decryptWithPrivateKey(
            encryptedPayload,
            convertBase64ToAsciiString(env.CRYPTO_PAYOUT_AUTHORIZER_PRIVATE_KEY),
            env.CRYPTO_PAYOUT_AUTHORIZER_PASSPHRASE
        );

        return cryptoPayoutAuthorizationPayloadSchema.parse(JSON.parse(decryptedPayload));
    }

    public static async createOnrampCryptoPayoutOrder(params: CreateCryptoPayoutOrderParams) {
        const onrampTransactionStatus = await FiatRampService.getTransactionStatus(
            params.triggerTransactionId,
            'onramp'
        );

        if (onrampTransactionStatus !== 'complete') {
            throw new Error('Onramp transaction is not completed');
        }

        const cryptoPayoutOrderAuthorityToken = this.generateOnrampCryptoPayoutOrderReference(
            params.triggerTransactionId
        );
        const cryptoPayoutOrderReference = cryptoPayoutOrderAuthorityToken.slice(0, 24);

        const { triggerTransactionId, ...cryptoPayoutOrderParams } = params;

        return await this.cryptoPayoutOrderRepository.create(cryptoPayoutOrderReference, {
            ...cryptoPayoutOrderParams,
            orderAuthorityToken: cryptoPayoutOrderAuthorityToken,
            status: CryptoPayoutOrderStatus.PENDING,
        });
    }
}

export default CryptoPayoutService;
