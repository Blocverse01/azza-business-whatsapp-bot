import env from '@/constants/env';
import axios from 'axios';
import slugify from 'slugify';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import { HttpException } from '@/resources/exceptions/HttpException';
import logger from '@/resources/logger';
import {
    AuthTokenResponse,
    AccessTokenResult,
    SupportedBankResponse,
    BankAccountVerificationResponse,
    accountNameEnquirySchema,
    BankAccountBalance,
    TransactionResponse,
    vasServicesSchema,
    VasServiceCategoriesResponse,
    VasServiceCategoryResult,
    VasServiceCategoryProductsResponse,
    VasServiceResult,
    ExecuteBuyTransactionPayload,
    VAS_ENDPOINTS,
    VASServiceType,
    PAYLOAD_SCHEMAS,
    NGNVasPaymentSettlement,
    VasServicePayload,
    VasServiceCategoryProductWithId,
} from './SafeHaveSchema';
import { BAD_REQUEST, INTERNAL_SERVER_ERROR, NOT_FOUND, OK } from '@/constants/status-codes';
import { safeHavenVasServices } from './WhitelistedVasServices';
import { dbClient } from '@/db/dbClient';
import { transactionStatusSchema } from '@/app/FiatRamp/fiatRampSchema';
import { TransactionType } from '@/app/ngn-vas-payment/queue-utils';
import { prettifyNumber } from '@/resources/utils/currency';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';

class SafeHavenService {
    private static readonly GRANT_TYPE = 'client_credentials';
    private static readonly CLIENT_ASSERTION_TYPE =
        'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
    private static readonly SAVEHAVEN_BASE_URL = env.SAFEHAVEN_BASE_URL;
    private static readonly SAVEHAVEN_CLIENT_ID = env.SAFEHAVEN_CLIENT_ID;
    private static readonly SAVEHAVEN_CLIENT_ASSERTION = env.SAFEHAVEN_CLIENT_ASSERTION;
    private static readonly SAVEHAVEN_ACCOUNT_NUMBER = '0117226117';
    private static readonly SAVEHEVEN_ACCOUNT_ID = '67c8b8242a82110024bcaf97';
    private static readonly NGN_VAS_TRANSACTION_REPOSITORY =
        dbClient.ngn_vas_settlement_transaction;

    private static accessToken: string | null = null;
    private static tokenExpiry: number | null = null;
    private static ibsClientId: string | null = null;

    public static async generateAccessToken(): Promise<AccessTokenResult> {
        try {
            const currentTime = Date.now();

            if (this.accessToken && this.tokenExpiry && currentTime < this.tokenExpiry) {
                return {
                    access_token: this.accessToken,
                    ibs_client_id: this.ibsClientId as string,
                };
            }

            const payload = {
                grant_type: this.GRANT_TYPE,
                client_assertion_type: this.CLIENT_ASSERTION_TYPE,
                client_id: this.SAVEHAVEN_CLIENT_ID,
                client_assertion: this.SAVEHAVEN_CLIENT_ASSERTION,
            };

            const response = await axios.post<AuthTokenResponse>(
                `${this.SAVEHAVEN_BASE_URL}/oauth2/token`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            const { ibs_client_id, access_token, expires_in } = response.data;

            this.accessToken = access_token;
            this.ibsClientId = ibs_client_id;
            this.tokenExpiry = Date.now() + expires_in * 1000;

            return {
                access_token,
                ibs_client_id,
            };
        } catch (error) {
            await logServiceError(error, 'Error generating SavaHaven access token');
            throw error;
        }
    }

    public static async getSafeHavenTransactionBySessionId(sessionId: string) {
        try {
            const authTokenData = await this.generateAccessToken();

            const payload = {
                sessionId: sessionId,
            };

            const response = await axios.post<TransactionResponse>(
                `${this.SAVEHAVEN_BASE_URL}/transfers/status`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.access_token}`,
                        ClientID: `${authTokenData.ibs_client_id}`,
                    },
                }
            );

            const { data, statusCode, message } = response.data;

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            return data;
        } catch (error) {
            await logServiceError(error, 'Error fetching transaction status from safehaven');
            throw error;
        }
    }

    public static async getSupportedBanks(): Promise<
        { name: string; slug: string; bankCode: string }[]
    > {
        try {
            const authTokenData = await this.generateAccessToken();

            const response = await axios.get<SupportedBankResponse>(
                `${this.SAVEHAVEN_BASE_URL}/transfers/banks`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.access_token}`,
                        ClientID: `${authTokenData.ibs_client_id}`,
                    },
                }
            );

            const { data: banks, statusCode, message } = response.data;

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            const supportedBanks = banks.map((bank) => ({
                name: bank.name,
                slug: slugify(bank.name, { lower: true, replacement: '-' }),
                bankCode: bank.bankCode,
            }));

            return supportedBanks;
        } catch (error) {
            await logServiceError(error, 'Error fetching supported banks from SavaHaven');
            throw error;
        }
    }

    public static async accountNameEnquiry(params: { bankCode: string; accountNumber: string }) {
        try {
            const { bankCode, accountNumber } = params;

            const authTokenData = await this.generateAccessToken();

            const result = accountNameEnquirySchema.safeParse(params);

            if (!result.success) {
                throw new HttpException(BAD_REQUEST, `${result.error.message}`);
            }

            const payload = {
                bankCode: bankCode,
                accountNumber: accountNumber,
            };

            const response = await axios.post<BankAccountVerificationResponse>(
                `${this.SAVEHAVEN_BASE_URL}/transfers/name-enquiry`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.access_token}`,
                        ClientID: `${authTokenData.ibs_client_id}`,
                    },
                }
            );

            const { data, statusCode, message } = response.data;

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            return {
                sessionId: data.sessionId,
                bankCode: data.bankCode,
                accountNumber: data.accountNumber,
                accountName: data.accountName,
            };
        } catch (error) {
            await logServiceError(error, 'Error fetching user account name');
            throw error;
        }
    }

    public static async getSafeHavenAccountBalance() {
        try {
            const authTokenData = await this.generateAccessToken();

            const response = await axios.get<BankAccountBalance>(
                `${this.SAVEHAVEN_BASE_URL}/accounts/${this.SAVEHEVEN_ACCOUNT_ID}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.access_token}`,
                        ClientID: `${authTokenData.ibs_client_id}`,
                    },
                }
            );

            const { statusCode, message, data: account } = response.data;

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            return account.accountBalance;
        } catch (error) {
            await logServiceError(error, 'Error fetching blocverse account balance from SavaHaven');
            throw error;
        }
    }

    public static async processOffRampPaymentWithSaveHaven(params: {
        nameEnquiryReference: string;
        beneficiaryBankCode: string;
        amountToSend: number;
        beneficiaryAccountNumber: string;
        sequenceId: string;
        narration?: string;
    }) {
        try {
            const {
                nameEnquiryReference,
                sequenceId,
                beneficiaryBankCode,
                amountToSend,
                beneficiaryAccountNumber,
            } = params;

            const authTokenData = await this.generateAccessToken();

            const payload = {
                saveBeneficiary: true,
                nameEnquiryReference: nameEnquiryReference,
                debitAccountNumber: this.SAVEHAVEN_ACCOUNT_NUMBER,
                beneficiaryBankCode: beneficiaryBankCode,
                beneficiaryAccountNumber: beneficiaryAccountNumber,
                amount: amountToSend,
                narration: params.narration ?? 'AZZA',
                paymentReference: sequenceId,
            };

            const response = await axios.post(`${this.SAVEHAVEN_BASE_URL}/transfers`, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authTokenData.access_token}`,
                    ClientID: `${authTokenData.ibs_client_id}`,
                },
            });

            const { data, statusCode, message } = response.data;

            void logger.info(
                `Processing safehaven off-ramp transaction of ${amountToSend} NGN to beneficiary account: ${beneficiaryAccountNumber}, sequenceId : ${sequenceId}`
            );

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            void logger.info(
                `Successfully sent ${amountToSend} NGN to beneficiary account: ${beneficiaryAccountNumber}, sequenceId: ${sequenceId}`
            );

            return {
                sequenceId: sequenceId,
                sessionId: data.sessionId,
            };
        } catch (error) {
            await logServiceError(error, 'Error processing safehaven Off-Ramp Transaction');
            throw error;
        }
    }

    public static async getSafeHavenVasServices() {
        try {
            const data = vasServicesSchema.parse(Object.values(safeHavenVasServices));
            return data;
        } catch (error) {
            await logServiceError(error, 'Error fetching VAS Services from SavaHaven');
            throw error;
        }
    }

    public static async getSafeHavenVasServiceCategories(
        serviceId: string
    ): Promise<VasServiceCategoryResult[]> {
        try {
            const authTokenData = await this.generateAccessToken();

            const response = await axios.get<VasServiceCategoriesResponse>(
                `${this.SAVEHAVEN_BASE_URL}/vas/service/${serviceId}/service-categories`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.access_token}`,
                        ClientID: `${authTokenData.ibs_client_id}`,
                    },
                }
            );

            const { statusCode, message, data: categories } = response.data;

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            const VasServiceCategories = categories.map((category) => ({
                id: category._id,
                name: category.name,
                identifier: category.identifier,
                serviceId: category.service,
                isFixedAmount: category.isFixedAmount,
                description: category.description,
                logoUrl: category.logoUrl,
            }));

            return VasServiceCategories;
        } catch (error) {
            await logServiceError(error, 'Error fetching VAS service categories from SavaHaven');
            throw error;
        }
    }

    public static async getSafeHavenDataVasServiceCategoryProducts(
        categoryId: string,
        cappedAmount: number
    ): Promise<VasServiceCategoryProductWithId[]> {
        try {
            const authTokenData = await this.generateAccessToken();

            const response = await axios.get<VasServiceCategoryProductsResponse>(
                `${this.SAVEHAVEN_BASE_URL}/vas/service-category/${categoryId}/products`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.access_token}`,
                        ClientID: `${authTokenData.ibs_client_id}`,
                    },
                }
            );

            const { statusCode, message, data: products } = response.data;

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            const VasServiceCategoryProducts = products
                .filter((product) => parseFloat(product.amount) >= cappedAmount)
                .map((product, index) => ({
                    id: (index + 1).toString(),
                    validity: product.validity,
                    bundleCode: product.bundleCode,
                    amount: product.amount,
                    isAmountFixed: product.isAmountFixed,
                }));

            return VasServiceCategoryProducts;
        } catch (error) {
            await logServiceError(error, 'Error fetching VAS service categories from SavaHaven');
            throw error;
        }
    }

    public static async processVASPayment<T extends VASServiceType>(
        input: ExecuteBuyTransactionPayload<T>
    ): Promise<VasServiceResult> {
        PAYLOAD_SCHEMAS[input.type].parse(input.payload);
        const endpoint = VAS_ENDPOINTS[input.type];

        try {
            const authTokenData = await this.generateAccessToken();

            void logger.info(
                `[${input.type.toUpperCase()}] Sending request to ${endpoint} endpoint...`
            );

            const payload = {
                ...input.payload,
                debitAccountNumber: this.SAVEHAVEN_ACCOUNT_NUMBER,
                channel: 'WEB',
            };

            const response = await axios.post<VasServiceResult>(
                `${this.SAVEHAVEN_BASE_URL}/vas/pay/${endpoint}`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.access_token}`,
                        ClientID: `${authTokenData.ibs_client_id}`,
                    },
                }
            );

            const { statusCode, message } = response.data;

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            return response.data;
        } catch (error) {
            await logServiceError(error, `Error processing safehaven vas transaction`);
            throw error;
        }
    }

    public static async payDataBundle(
        ngnVasSettlementId: string,
        userPhoneNumber: string,
        transactionHash: string,
        payload: VasServicePayload
    ) {
        const response = await SafeHavenService.processVASPayment({
            type: VASServiceType.DATA,
            payload,
        });
        const updateParmas = {
            sequenceId: response.data.reference,
            processingStatus: transactionStatusSchema.parse('processing'),
            transactionHash: transactionHash,
        };

        if (response.data) {
            const isUpdate = await this.updatePaymentSettlementById(
                ngnVasSettlementId,
                userPhoneNumber,
                updateParmas
            );
            if (!isUpdate)
                throw new HttpException(
                    INTERNAL_SERVER_ERROR,
                    `Failed to update data bundle transaction`
                );
        }

        return { sequenceId: response.data.id };
    }

    public static async payUtility(payload: VasServicePayload): Promise<{}> {
        return await SafeHavenService.processVASPayment({ type: VASServiceType.UTILITY, payload });
    }

    public static async payAirtime(
        ngnVasSettlementId: string,
        userPhoneNumber: string,
        transactionHash: string,
        payload: VasServicePayload
    ) {
        const response = await SafeHavenService.processVASPayment({
            type: VASServiceType.AIRTIME,
            payload,
        });
        const updateParmas = {
            sequenceId: response.data.reference,
            processingStatus: transactionStatusSchema.parse('processing'),
            transactionHash: transactionHash,
        };
        if (response.data) {
            const isUpdate = await this.updatePaymentSettlementById(
                ngnVasSettlementId,
                userPhoneNumber,
                updateParmas
            );
            if (!isUpdate)
                throw new HttpException(
                    INTERNAL_SERVER_ERROR,
                    `Failed to update airtime transaction`
                );
        }

        return { sequenceId: response.data.id };
    }

    public static async createVasPaymentSettlement(offrampTransaction: NGNVasPaymentSettlement) {
        return await this.NGN_VAS_TRANSACTION_REPOSITORY.create({
            localAmount: offrampTransaction.localAmount,
            usdAmount: offrampTransaction.usdAmount,
            transactionFeeUsd: offrampTransaction.transactionFeeUsd,
            conversionRate: offrampTransaction.rate,
            paymentCurrency: offrampTransaction.localCurrencySymbol,
            localCurrencySymbol: offrampTransaction.localCurrencySymbol,
            transactionHash: offrampTransaction.transactionHash,
            processingStatus: transactionStatusSchema.parse('pending'),
            ownerId: offrampTransaction.ownerId,
            sequenceId: offrampTransaction.sequenceId,
            blockchainNetwork: offrampTransaction.blockchainNetwork,
            fromWalletAddress: offrampTransaction.fromWalletAddress,
            platformFeePercentage: offrampTransaction.platformFeePercentage,
            hotWalletAddress: offrampTransaction.hotWalletAddress,
            recipientPhoneNumber: offrampTransaction.recipient.recipientPhoneNumber,
            recipientMeterNumber: offrampTransaction.recipient.recipientMeterNumber,
            tokenAddress: offrampTransaction.tokenAddress,
            tokenSymbol: offrampTransaction.tokenSymbol,
            country: offrampTransaction.recipient.country,
            processorName: offrampTransaction.processorName,
            transactionType: offrampTransaction.transactionType,
            serviceCategoryId: offrampTransaction.recipient.serviceCategoryId,
            distributionName: offrampTransaction.recipient.distributionName,
            bundleCode: offrampTransaction.recipient.bundleCode,
        });
    }

    public static async getVasPaymentSettlementById(settlementId: string) {
        const transaction = await this.NGN_VAS_TRANSACTION_REPOSITORY.read(settlementId);

        if (!transaction) {
            throw new HttpException(NOT_FOUND, 'Transaction not found');
        }

        const transactionRecord = {
            id: transaction.id,
            recipient: {
                recipientPhoneNumber: transaction.recipientPhoneNumber,
                recipientMeterNumber: transaction.recipientMeterNumber,
                serviceCategoryId: transaction.serviceCategoryId,
                bundleCode: transaction.bundleCode,
                country: transaction.country,
            },
            blockchainNetwork: transaction.blockchainNetwork,
            usdAmount: transaction.usdAmount,
            localAmount: transaction.localAmount,
            localCurrencySymbol: transaction.localCurrencySymbol,
            tokenSymbol: transaction.tokenSymbol,
            ownerId: transaction.ownerId,
            transactionHash: transaction.transactionHash,
            transactionFeeUsd: transaction.transactionFeeUsd,
            createdAt: transaction.xata.createdAt.toISOString(),
            status: transaction.processingStatus,
            rate: transaction.conversionRate!,
            sequenceId: transaction.sequenceId,
            hotWalletAddress: transaction.hotWalletAddress,
            platformFeePercentage: transaction.platformFeePercentage,
            fromWalletAddress: transaction.fromWalletAddress,
            tokenAddress: transaction.tokenAddress,
            processorName: transaction.processorName,
            transactionType: transaction.transactionType,
        };

        return transactionRecord;
    }

    public static async updatePaymentSettlementById(
        settlementId: string,
        userPhoneNumber: string,
        params: { sequenceId: string; processingStatus: string }
    ) {
        const settlement = await this.NGN_VAS_TRANSACTION_REPOSITORY.filter({
            id: settlementId,
        }).getFirst();

        if (!settlement) {
            throw new HttpException(NOT_FOUND, 'Transaction not found');
        }

        let transactionMessage = '';
        const transactionType = settlement.transactionType as TransactionType;

        if (transactionType === 'airtime') {
            transactionMessage = `Recharge ${settlement.localCurrencySymbol}${prettifyNumber(settlement.localAmount!)} airtime on ${settlement.distributionName?.toUpperCase()} (${settlement.recipientPhoneNumber})`;
        }

        if (transactionType === 'data') {
            transactionMessage = `Buy ${settlement.bundleCode!} for ${settlement.localCurrencySymbol}${prettifyNumber(settlement.localAmount!)} on ${settlement.distributionName?.toUpperCase()} (${settlement.recipientPhoneNumber})`;
        }

        await this.sendArbitraryTextMessage(
            this.processingTransactionMessage(transactionType, transactionMessage),
            userPhoneNumber
        );

        return await settlement.update({
            ...params,
        });
    }

    public static async getNGNVasProcessingTransactions() {
        const transactions = await this.NGN_VAS_TRANSACTION_REPOSITORY.filter({
            processingStatus: transactionStatusSchema.parse('processing'),
            sequenceId: { $isNot: null },
        }).getAll();

        transactions.map((transaction) => {
            return {
                id: transaction.id,
                recipient: {
                    recipientPhoneNumber: transaction.recipientPhoneNumber,
                    recipientMeterNumber: transaction.recipientMeterNumber,
                    serviceCategoryId: transaction.serviceCategoryId,
                    bundleCode: transaction.bundleCode,
                    country: transaction.country,
                },
                blockchainNetwork: transaction.blockchainNetwork,
                usdAmount: transaction.usdAmount,
                localAmount: transaction.localAmount,
                localCurrencySymbol: transaction.localCurrencySymbol,
                tokenSymbol: transaction.tokenSymbol,
                ownerId: transaction.ownerId,
                transactionHash: transaction.transactionHash,
                transactionFeeUsd: transaction.transactionFeeUsd,
                createdAt: transaction.xata.createdAt.toISOString(),
                status: transaction.processingStatus,
                rate: transaction.conversionRate!,
                sequenceId: transaction.sequenceId,
                hotWalletAddress: transaction.hotWalletAddress,
                platformFeePercentage: transaction.platformFeePercentage,
                fromWalletAddress: transaction.fromWalletAddress,
                tokenAddress: transaction.tokenAddress,
                processorName: transaction.processorName,
                transactionType: transaction.transactionType,
            };
        });

        return transactions;
    }

    public static async getNGNVasProcessingTransaction(transactionId: string) {
        const transaction = await this.NGN_VAS_TRANSACTION_REPOSITORY.filter({
            processingStatus: transactionStatusSchema.parse('processing'),
            sequenceId: transactionId,
        }).getFirst();

        if (!transaction) {
            throw new HttpException(NOT_FOUND, 'Transaction not found');
        }

        return transaction;
    }

    public static async getSafeHavenVasPaymentByTransactionId(transactionId: string) {
        try {
            const authTokenData = await this.generateAccessToken();

            const response = await axios.get(
                `${this.SAVEHAVEN_BASE_URL}/vas/transaction/${transactionId}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.access_token}`,
                        ClientID: `${authTokenData.ibs_client_id}`,
                    },
                }
            );

            const { data, statusCode, message } = response.data;

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            return data;
        } catch (error) {
            await logServiceError(error, 'Error fetching transaction status from safehaven');
            throw error;
        }
    }

    public static processingTransactionMessage(
        txT: TransactionType,
        transactionDetailsString: string
    ) {
        const message = `⏳ Your ${txT === 'data' ? 'data bundle' : 'airtime'} transaction is being processed:\n\n${transactionDetailsString}\n\nPlease be patient.`;
        return message;
    }

    public static async sendArbitraryTextMessage(message: string, userPhoneNumber: string) {
        if (message.trim()) {
            try {
                await WhatsAppBotService.sendArbitraryTextMessage(userPhoneNumber, message);
            } catch (error) {}
        }
    }
}

export default SafeHavenService;
