import { dbClient, sqlClient } from '@/db/dbClient';
import {
    CreateCryptoPayoutOrderParams,
    CryptoPayoutAuthorizationPayload,
    cryptoPayoutAuthorizationPayloadSchema,
    CryptoPayoutOrderStatus,
    CryptoPayoutReasons,
} from '@/app/CryptoPayout/cryptoPayoutSchema';
import { decryptWithAES, encryptWithAES } from '@/resources/utils/encryption';
import env from '@/constants/env';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { CryptoPayoutOrder } from '@/db/xata';

class CryptoPayoutService {
    private static readonly cryptoPayoutOrderRepository = dbClient.CryptoPayoutOrder;
    private static readonly ORDER_REFERENCE_LENGTH = 24;

    private static generateOnrampCryptoPayoutOrderReference(onrampTransactionId: string) {
        const cryptoPayoutTrigger = {
            reason: CryptoPayoutReasons.ONRAMP,
            triggerTransactionId: onrampTransactionId,
        } satisfies CryptoPayoutAuthorizationPayload;

        return encryptWithAES(
            JSON.stringify(cryptoPayoutTrigger),
            env.CRYPTO_PAYOUT_AUTHORIZER_KEY,
            env.CRYPTO_PAYOUT_AUTHORIZER_IV
        );
    }

    public static validateCryptoPayoutAuthorizationPayload(encryptedPayload: string) {
        const decryptedPayload = decryptWithAES(
            encryptedPayload,
            env.CRYPTO_PAYOUT_AUTHORIZER_KEY,
            env.CRYPTO_PAYOUT_AUTHORIZER_IV
        );

        return cryptoPayoutAuthorizationPayloadSchema.parse(JSON.parse(decryptedPayload));
    }

    public static validateCryptoPayoutOrder(orderAuthorityToken: string) {
        return !!this.validateCryptoPayoutAuthorizationPayload(orderAuthorityToken);
    }

    public static async createOnrampCryptoPayoutOrder(params: CreateCryptoPayoutOrderParams) {
        const onrampTransactionStatus = await FiatRampService.getTransactionStatus(
            params.triggerTransactionId,
            'onramp'
        );

        if (onrampTransactionStatus.toLowerCase() !== 'complete') {
            throw new Error('Onramp transaction is not completed');
        }

        const cryptoPayoutOrderAuthorityToken = this.generateOnrampCryptoPayoutOrderReference(
            params.triggerTransactionId
        );

        const existingAuthorityToken = await this.cryptoPayoutOrderRepository
            .filter({
                orderAuthorityToken: cryptoPayoutOrderAuthorityToken,
            })
            .getFirst();

        if (existingAuthorityToken) {
            throw new Error('Crypto payout order already exists');
        }

        const { triggerTransactionId, ...cryptoPayoutOrderParams } = params;

        return await this.cryptoPayoutOrderRepository.create({
            ...cryptoPayoutOrderParams,
            orderAuthorityToken: cryptoPayoutOrderAuthorityToken,
            status: CryptoPayoutOrderStatus.PENDING,
        });
    }

    public static async getOnrampCryptoPayoutOrder(cryptoPayoutOrderReference: string) {
        return await this.cryptoPayoutOrderRepository.read(cryptoPayoutOrderReference);
    }

    public static async updateCryptoPayoutOrdersStatus(
        orderIds: string[],
        status: CryptoPayoutOrderStatus
    ) {
        let query = `Update "CryptoPayoutOrder" set "status" = ${status} where "id" in ` + `(`;

        orderIds.forEach((x) => {
            query += `'${x}', `;
        });
        query = query.slice(0, -2) + `)`;

        return await sqlClient<CryptoPayoutOrder>({
            statement: query,
        });
    }

    public static async updateCryptoPayoutOrdersTransactionHash(
        orderIds: string[],
        transactionHash: string
    ) {
        let query =
            `Update "CryptoPayoutOrder" set "payoutTransactionHash" = ${transactionHash} where "id" in ` +
            `(`;

        orderIds.forEach((x) => {
            query += `'${x}', `;
        });
        query = query.slice(0, -2) + `)`;

        return await sqlClient<CryptoPayoutOrder>({
            statement: query,
        });
    }

    public static async getValidPendingCryptoPayoutOrders() {
        const pendingCryptoPayoutOrders = await this.cryptoPayoutOrderRepository
            .filter({
                status: CryptoPayoutOrderStatus.PENDING,
            })
            .getAll();

        return pendingCryptoPayoutOrders.filter((payoutOrder) => {
            const { id, orderAuthorityToken } = payoutOrder;
            return this.validateCryptoPayoutOrder(orderAuthorityToken);
        });
    }
}

export default CryptoPayoutService;
