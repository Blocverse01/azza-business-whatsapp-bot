import { BlockradarMasterWalletApiClientError } from '@/app/Blockradar/errors';
import {
    blockradarAddressBalanceSchema,
    blockradarAddressBalancesSchema,
    blockradarAddressSchema,
    blockradarBaseApiResponseSchema,
    blockradarTransactionSchema,
    GenerateAddressRequestBody,
    generateAddressRequestBodySchema,
    UpdateAddressRequestBody,
    updateAddressRequestBodySchema,
    WithdrawAssetRequestBody,
    withdrawAssetRequestBodySchema,
    withdrawAssetResponseDataSchema,
    type BlockradarTransactionType,
} from '@/app/Blockradar/schema';
import { OK } from '@/constants/status-codes';
import { z } from 'zod';

export type BlockradarMasterWalletApiClientConstructorParams = {
    baseUrl: string;
    apiKey: string;
    masterWalletId: string;
    debug?: boolean;
};

enum MasterWalletApiResources {
    ADDRESS = 'addresses',
    TRANSACTION = 'transactions',
}

class BlockradarMasterWalletApiClient {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly masterWalletId: string;
    private readonly debug: boolean = false;

    constructor(params: BlockradarMasterWalletApiClientConstructorParams) {
        this.baseUrl = params.baseUrl;
        this.apiKey = params.apiKey;
        this.masterWalletId = params.masterWalletId;
        this.debug = params.debug || false;
    }

    public async generateAddress(params: GenerateAddressRequestBody) {
        const bodyPayload = generateAddressRequestBodySchema.parse(params);
        const addressResourceUrl = this.getResourceUrl(MasterWalletApiResources.ADDRESS);

        const response = await this.fetch(addressResourceUrl, {
            headers: this.headers,
            method: 'POST',
            body: JSON.stringify(bodyPayload),
        });

        if (response.statusCode !== OK) {
            throw new BlockradarMasterWalletApiClientError({
                message: response.message,
                requestUrl: addressResourceUrl,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        const generatedAddressData = blockradarAddressSchema.safeParse(response.data);

        if (!generatedAddressData.success) {
            throw new BlockradarMasterWalletApiClientError({
                message: generatedAddressData.error.message,
                requestUrl: addressResourceUrl,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        return generatedAddressData.data;
    }

    public async getAddress(addressId: string) {
        const addressResourceUrl = this.getResourceUrl(MasterWalletApiResources.ADDRESS);
        const url = `${addressResourceUrl}/${addressId}`;

        const response = await this.fetch(url, {
            headers: this.headers,
            method: 'GET',
        });

        if (response.statusCode !== OK) {
            throw new BlockradarMasterWalletApiClientError({
                message: response.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        const validatedData = blockradarAddressSchema.safeParse(response.data);

        if (!validatedData.success) {
            throw new BlockradarMasterWalletApiClientError({
                message: validatedData.error.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        return validatedData.data;
    }

    public async searchAddressByMetadata(metadata: Record<string, unknown>) {
        const addressResourceUrl = this.getResourceUrl(MasterWalletApiResources.ADDRESS);
        const encodedMetadata = encodeURIComponent(JSON.stringify(metadata));
        const url = `${addressResourceUrl}?metadata=${encodedMetadata}`;

        const response = await this.fetch(url, {
            headers: this.headers,
            method: 'GET',
        });

        if (response.statusCode !== OK) {
            throw new BlockradarMasterWalletApiClientError({
                message: response.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        const validatedData = z.array(blockradarAddressSchema).safeParse(response.data);

        if (!validatedData.success) {
            throw new BlockradarMasterWalletApiClientError({
                message: validatedData.error.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        const targetAddress = validatedData.data[0];
        return targetAddress ?? null;
    }

    public async getBalances(addressId: string) {
        const addressResourceUrl = this.getResourceUrl(MasterWalletApiResources.ADDRESS);
        const url = `${addressResourceUrl}/${addressId}/balances`;

        const response = await this.fetch(url, {
            headers: this.headers,
            method: 'GET',
        });

        if (response.statusCode !== OK) {
            throw new BlockradarMasterWalletApiClientError({
                message: response.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        const validatedData = blockradarAddressBalancesSchema.safeParse(response.data);

        if (!validatedData.success) {
            throw new BlockradarMasterWalletApiClientError({
                message: validatedData.error.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        return validatedData.data;
    }

    public async getBalance(addressId: string, assetId: string) {
        const addressResourceUrl = this.getResourceUrl(MasterWalletApiResources.ADDRESS);
        const url = `${addressResourceUrl}/${addressId}/balance?assetId=${assetId}`;

        const response = await this.fetch(url, {
            headers: this.headers,
            method: 'GET',
        });

        if (response.statusCode !== OK) {
            throw new BlockradarMasterWalletApiClientError({
                message: response.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        const validatedData = blockradarAddressBalanceSchema.safeParse(response.data);

        if (!validatedData.success) {
            throw new BlockradarMasterWalletApiClientError({
                message: validatedData.error.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        return validatedData.data;
    }

    public async getTransaction(transactionId: string) {
        const transactionResourceUrl = this.getResourceUrl(MasterWalletApiResources.TRANSACTION);
        const url = `${transactionResourceUrl}/${transactionId}`;

        const response = await this.fetch(url, {
            headers: this.headers,
            method: 'GET',
        });

        if (response.statusCode !== OK) {
            throw new BlockradarMasterWalletApiClientError({
                message: response.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        const validatedData = blockradarTransactionSchema.safeParse(response.data);

        if (!validatedData.success) {
            throw new BlockradarMasterWalletApiClientError({
                message: validatedData.error.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        return validatedData.data;
    }

    public async getTransactionByHash(
        transactionHash: string,
        targetTransactionType?: BlockradarTransactionType
    ) {
        const transactionResourceUrl = this.getResourceUrl(MasterWalletApiResources.TRANSACTION);
        const url = transactionResourceUrl + `?hash=${transactionHash}`;

        const response = await this.fetch(url, {
            headers: this.headers,
            method: 'GET',
        });

        if (response.statusCode !== OK) {
            throw new BlockradarMasterWalletApiClientError({
                message: response.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        const validatedData = z.array(blockradarTransactionSchema).safeParse(response.data);

        if (!validatedData.success) {
            throw new BlockradarMasterWalletApiClientError({
                message: validatedData.error.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        const targetTransaction = validatedData.data.find(
            (transaction) =>
                transaction.hash?.toLowerCase() === transactionHash.toLowerCase() &&
                (targetTransactionType ? transaction.type === targetTransactionType : true)
        );

        return targetTransaction ?? null;
    }

    public async updateAddress(addressId: string, params: UpdateAddressRequestBody) {
        const addressResourceUrl = this.getResourceUrl(MasterWalletApiResources.ADDRESS);
        const url = `${addressResourceUrl}/${addressId}`;

        const bodyPayload = updateAddressRequestBodySchema.parse(params);

        const response = await this.fetch(url, {
            headers: this.headers,
            method: 'PATCH',
            body: JSON.stringify(bodyPayload),
        });

        if (response.statusCode !== OK) {
            throw new BlockradarMasterWalletApiClientError({
                message: response.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
            });
        }

        const updatedAddressData = blockradarAddressSchema.safeParse(response.data);

        if (!updatedAddressData.success) {
            throw new BlockradarMasterWalletApiClientError({
                message: updatedAddressData.error.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
                requestData: bodyPayload,
            });
        }

        return updatedAddressData.data;
    }

    public async withdraw(addressId: string, params: WithdrawAssetRequestBody) {
        const addressResourceUrl = this.getResourceUrl(MasterWalletApiResources.ADDRESS);
        const url = `${addressResourceUrl}/${addressId}/withdraw`;

        const bodyPayload = withdrawAssetRequestBodySchema.parse(params);

        const response = await this.fetch(url, {
            headers: this.headers,
            method: 'POST',
            body: JSON.stringify(bodyPayload),
        });

        if (response.statusCode !== OK) {
            throw new BlockradarMasterWalletApiClientError({
                message: response.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
                requestData: bodyPayload,
            });
        }

        const responseDataValidation = withdrawAssetResponseDataSchema.safeParse(response.data);

        if (!responseDataValidation.success) {
            throw new BlockradarMasterWalletApiClientError({
                message: responseDataValidation.error.message,
                requestUrl: url,
                statusCode: response.statusCode,
                rawJsonResponse: response,
                requestData: bodyPayload,
            });
        }

        return responseDataValidation.data;
    }

    private getResourceUrl(resource: MasterWalletApiResources) {
        return `${this.baseUrl}/wallets/${this.masterWalletId}/${resource}` as const;
    }

    private get headers() {
        return {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
        };
    }

    private async fetch(url: string, options: RequestInit) {
        if (this.debug) {
            console.time(`${options.method} [${url}]`);
        }
        const response = await fetch(url, options);

        let responseData = {};

        try {
            const responseText = await response.text();
            try {
                responseData = JSON.parse(responseText);
            } catch (jsonError) {
                responseData = {
                    message: responseText,
                    statusCode: response.status,
                };
            }
        } catch (error) {
            responseData = {
                message: 'Failed to read response text',
                statusCode: response.status,
            };
        }

        if (this.debug) {
            console.timeEnd(`${options.method} [${url}]`);
        }

        const validatedData = blockradarBaseApiResponseSchema.safeParse(responseData);

        if (!validatedData.success) {
            throw new BlockradarMasterWalletApiClientError({
                message: validatedData.error.message,
                requestUrl: url,
                statusCode: response.status,
                rawJsonResponse: responseData,
                requestData: options.body,
            });
        }

        return validatedData.data;
    }
}

export default BlockradarMasterWalletApiClient;
