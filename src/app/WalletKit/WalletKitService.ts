import redis from '@/app/cache/redis';
import env from '@/constants/env';
import {
    createWalletKitWalletParams,
    CreateWalletKitWalletParams,
    CreateWalletKitWalletResponse,
    SignAndSendTransactionParams,
    TransactionResponse,
    signAndSendTransactionSchema,
    SUPPORTED_CHAINS,
    SupportedChain,
    transferTokenParams,
    TransferTokenParams,
    TokenBalancesResponse,
    BatchTransferTokenParams,
    ExportWalletParams,
    ExportWalletResponse,
} from '@/app/WalletKit/walletKitSchema';
import {
    BATCH_TRANSFER_TOKEN,
    EXPORT_WALLET,
    GET_TOKEN_BALANCES,
    GET_WALLET_BY_ADDRESS,
    GET_WALLET_BY_OWNER_ID,
    SIGN_AND_SEND_TRANSACTION,
    TRANSACTION_STATUS_BY_ID,
    TRANSFER_TOKEN,
    WALLETS,
} from '@/app/WalletKit/endpoints';
import { HttpException } from '@/resources/exceptions/HttpException';
import axios from 'axios';

class WalletKitService {
    private static API_URL =
        env.WEB3_ENVIRONMENT === 'testnet'
            ? env.WALLET_KIT_API_URL
            : env.WALLET_KIT_MAINNET_API_URL;
    public static readonly DEVELOPER_SECRET = env.WALLET_KIT_DEVELOPER_SECRET; // Using this until there's a suitable solution for migrating wallets created with wrong secret
    //env.WEB3_ENVIRONMENT === 'testnet'
    //? env.WALLET_KIT_DEVELOPER_SECRET
    //: env.WALLET_KIT_MAINNET_DEVELOPER_SECRET;

    private static get requiredRequestHeaders() {
        const apiToken =
            env.WEB3_ENVIRONMENT === 'testnet'
                ? env.WALLET_KIT_API_TOKEN
                : env.WALLET_KIT_MAINNET_API_TOKEN;
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiToken}`,
            'X-WalletKit-Project-ID': env.WALLET_KIT_PROJECT_ID,
        };
    }

    public static async createUserWallet(params: CreateWalletKitWalletParams) {
        const validatedParams = createWalletKitWalletParams.parse(params);
        const requestUrl = this.API_URL + WALLETS;

        const response = await axios.post<CreateWalletKitWalletResponse>(
            requestUrl,
            validatedParams,
            {
                headers: this.requiredRequestHeaders,
            }
        );

        return response.data;
    }

    public static async getUserWalletByNetwork(ownerId: string, network: SupportedChain) {
        const requestQueryParams = new URLSearchParams({
            ownerID: ownerId,
            network,
        });
        const requestUrl = `${this.API_URL}${GET_WALLET_BY_OWNER_ID}?${requestQueryParams.toString()}`;

        const cachedData = await redis.get(requestUrl);
        if (cachedData) {
            return JSON.parse(cachedData) as CreateWalletKitWalletResponse;
        }

        const response = await fetch(requestUrl, {
            method: 'GET',
            headers: this.requiredRequestHeaders,
        });

        if (!response.ok) {
            throw new HttpException(
                response.status,
                `Failed to fetch wallet for owner ${ownerId} on network ${network}`,
                await response.text()
            );
        }

        const wallet = (await response.json()) as CreateWalletKitWalletResponse;
        await redis.set(requestUrl, JSON.stringify(wallet));

        return wallet;
    }

    public static async getWalletByAddress(walletAddress: string, network: SupportedChain) {
        const requestQueryParams = new URLSearchParams({
            address: walletAddress,
            network,
        });
        const requestUrl = `${this.API_URL}${GET_WALLET_BY_ADDRESS}?${requestQueryParams.toString()}`;

        const cachedData = await redis.get(requestUrl);
        if (cachedData) {
            return JSON.parse(cachedData) as CreateWalletKitWalletResponse;
        }

        const response = await fetch(requestUrl, {
            headers: this.requiredRequestHeaders,
            method: 'GET',
        });

        if (!response.ok) {
            throw new HttpException(
                response.status,
                `Failed to fetch wallet for address ${walletAddress} on network ${network}`,
                await response.text()
            );
        }

        const wallet = (await response.json()) as CreateWalletKitWalletResponse;
        await redis.set(requestUrl, JSON.stringify(wallet));

        return wallet;
    }

    public static async getUserWallets(ownerId: string) {
        const promises = SUPPORTED_CHAINS.map((network) =>
            this.getUserWalletByNetwork(ownerId, network)
        );

        const settlements = await Promise.allSettled(promises);

        const fulfilledSettlements = settlements.filter(
            (settlement) => settlement.status === 'fulfilled'
        ) as Array<PromiseFulfilledResult<CreateWalletKitWalletResponse>>;

        return fulfilledSettlements
            .filter((settlement) => settlement.status === 'fulfilled')
            .map((settlement) => settlement.value);
    }

    public static async signAndSendTransaction(params: SignAndSendTransactionParams) {
        const validatedParams = signAndSendTransactionSchema.parse(params);
        const requestUrl = this.API_URL + SIGN_AND_SEND_TRANSACTION;

        const response = await axios.post<TransactionResponse>(requestUrl, validatedParams, {
            headers: this.requiredRequestHeaders,
        });

        return response.data;
    }

    public static async transferToken(params: TransferTokenParams) {
        const validatedParams = transferTokenParams.parse(params);

        const requestUrl = `${this.API_URL}${TRANSFER_TOKEN}`;

        const response = await axios.post<TransactionResponse>(requestUrl, validatedParams, {
            headers: this.requiredRequestHeaders,
        });

        return response.data;
    }

    public static async getTransactionById(transactionId: string) {
        const requestQueryParams = new URLSearchParams({
            id: transactionId,
        });
        const requestUrl = `${this.API_URL}${TRANSACTION_STATUS_BY_ID}?${requestQueryParams.toString()}`;

        const response = await axios.get<TransactionResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        return response.data;
    }

    public static async waitForTransactionHash(transactionId: string) {
        let transaction = await this.getTransactionById(transactionId);

        // Keep polling as long as transaction_hash is not set, regardless of the transaction status.
        while (!transaction.transaction_hash) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            transaction = await this.getTransactionById(transactionId);
        }

        return transaction as TransactionResponse & { transaction_hash: string };
    }

    // Todo: This functionality can fetch multiple balances for cases where that's needed... Instead of calling it multiple times.
    public static async getBalance(
        walletAddress: string,
        network: SupportedChain,
        contractAddress: string
    ) {
        const requestQueryParams = new URLSearchParams({
            wallet_address: walletAddress,
            network,
        });

        const requestUrl = `${this.API_URL}${GET_TOKEN_BALANCES}?${requestQueryParams.toString()}`;

        const response = await fetch(requestUrl, {
            headers: this.requiredRequestHeaders,
            method: 'GET',
        });

        if (!response.ok) {
            throw new HttpException(
                response.status,
                `Failed to fetch token balances for wallet ${walletAddress} on network ${network}`,
                await response.text()
            );
        }

        const tokenBalances = (await response.json()) as TokenBalancesResponse;

        const tokenBalance = tokenBalances.find(
            (tokenBalance) =>
                tokenBalance.contract_address.toLowerCase() === contractAddress.toLowerCase()
        );

        return tokenBalance?.display_balance ?? '0';
    }

    public static async batchTransferToken(params: BatchTransferTokenParams) {
        const requestUrl = `${this.API_URL}${BATCH_TRANSFER_TOKEN}`;

        const response = await axios.post<TransactionResponse>(requestUrl, params, {
            headers: this.requiredRequestHeaders,
        });

        return response.data;
    }

    public static async exportWallet(params: ExportWalletParams) {
        const requestUrl = `${this.API_URL}${EXPORT_WALLET}`;

        const response = await axios.post<ExportWalletResponse>(requestUrl, params, {
            headers: this.requiredRequestHeaders,
        });

        return response.data;
    }

    public static async getWalletsByNetwork(network: SupportedChain) {
        const requestQueryParams = new URLSearchParams({
            network,
        });

        const requestUrl = `${this.API_URL}${WALLETS}?${requestQueryParams.toString()}`;

        const response = await fetch(requestUrl, {
            headers: this.requiredRequestHeaders,
            method: 'GET',
        });

        if (!response.ok) {
            throw new HttpException(
                response.status,
                `Failed to fetch wallets on network ${network}`,
                await response.text()
            );
        }

        return (await response.json()) as CreateWalletKitWalletResponse[];
    }
}

export default WalletKitService;
