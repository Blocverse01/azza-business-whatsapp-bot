import {
    CreateCryptoPayoutOrderParams,
    CryptoPayoutAuthorizationPayload,
    cryptoPayoutAuthorizationPayloadSchema,
    CryptoPayoutOrderStatus,
    CryptoPayoutReasons,
} from '@/app/CryptoPayout/cryptoPayoutSchema';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import env from '@/constants/env';
import { dbClient, sqlClient } from '@/db/dbClient';
import { CryptoPayoutOrder } from '@/db/xata';
import { decryptWithAES, encryptWithAES } from '@/resources/utils/encryption';
import azzaWalletManager from '@/runtime/wallet';

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

    private static generateOfframpCryptoRefundOrderReference(offrampOnchainTransactionId: string) {
        const cryptoPayoutTrigger = {
            reason: CryptoPayoutReasons.OFFRAMP_REFUND,
            triggerTransactionId: offrampOnchainTransactionId,
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
        const onrampTransaction = await FiatRampService.getOnrampTransaction(
            params.triggerTransactionId
        );

        if (onrampTransaction.status !== 'complete') {
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
            amount: cryptoPayoutOrderParams.amount,
            tokenSymbol: cryptoPayoutOrderParams.tokenSymbol,
            network: cryptoPayoutOrderParams.network,
            destinationWalletAddress: cryptoPayoutOrderParams.destinationWalletAddress,
            orderAuthorityToken: cryptoPayoutOrderAuthorityToken,
            status: CryptoPayoutOrderStatus.PENDING,
            payoutType: cryptoPayoutOrderParams.payoutType,
        });
    }

    public static async createOfframpCryptoRefundOrder(params: CreateCryptoPayoutOrderParams) {
        const assetConfig = azzaWalletManager.searchAssets({
            tokenName: params.tokenSymbol,
            network: params.network,
        })[0];

        if (!assetConfig) {
            throw new Error('Asset config not found');
        }

        const onchainTransaction = await azzaWalletManager.getTransactionByHash(
            params.triggerTransactionId,
            assetConfig.network
        );

        if (onchainTransaction.status !== 'SUCCESS') {
            throw new Error(`Transaction ${params.triggerTransactionId} is not successful`);
        }

        const cryptoPayoutOrderAuthorityToken = this.generateOfframpCryptoRefundOrderReference(
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
            payoutType: cryptoPayoutOrderParams.payoutType,
        });
    }

    public static async getOnrampCryptoPayoutOrder(cryptoPayoutOrderReference: string) {
        return await this.cryptoPayoutOrderRepository.read(cryptoPayoutOrderReference);
    }

    public static async updateProcessedCryptPayoutOrder(
        orderId: string,
        updatableParams: {
            payoutTransactionHash: string | null | undefined;
            status: CryptoPayoutOrderStatus;
        }
    ) {
        return await this.cryptoPayoutOrderRepository.update(orderId, updatableParams, [
            'payoutTransactionHash',
            'status',
        ]);
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
            `Update "CryptoPayoutOrder" set "payoutTransactionHash" = '${transactionHash}' where "id" in ` +
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
            const { orderAuthorityToken } = payoutOrder;
            return this.validateCryptoPayoutOrder(orderAuthorityToken);
        });
    }
}

export default CryptoPayoutService;
