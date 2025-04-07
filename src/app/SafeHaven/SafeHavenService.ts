import env from "@/constants/env";
import axios from 'axios';
import slugify from 'slugify';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import ManualOfframpSettlementService from '@/app/FiatRamp/alternatives/ManualOfframpSettlementService';
import { HttpException } from '@/resources/exceptions/HttpException';
import logger from '@/resources/logger';
import {
    AuthTokenResponse,
    AccessTokenResult,
    SupportedBankResponse,
    BankAccountVerificationResponse,
    accountNameEnquirySchema,
    SaveHavenOfframpSettlement,
    BankAccountBalance
} from './SafeHaveSchema'
import { BAD_REQUEST, OK } from "@/constants/status-codes";
import { dbClient } from "@/db/dbClient";


class SafeHaveService {

    private static readonly GRANT_TYPE = 'client_credentials';
    private static readonly CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
    private static readonly SAVEHAVEN_BASE_URL = env.SAVEHAVEN_BASE_URL;
    private static readonly SAVEHAVEN_CLIENT_ID = env.SAVEHAVEN_CLIENT_ID;
    private static readonly SAVEHAVEN_CLIENT_ASSERTION = env.SAVEHAVEN_CLIENT_ASSERTION;
    private static readonly SAVEHAVEN_ACCOUNT_NUMBER = '0117226117';
    private static readonly SAVEHEVEN_ACCOUNT_ID = '67c8b8242a82110024bcaf97'
    private static readonly SAVEHAVEN_OFFRAMP_TRANSACTION_REPOSITORY = dbClient.safehaven_offramp_settlement_transaction
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
                client_assertion: this.SAVEHAVEN_CLIENT_ASSERTION
            };

            const response = await axios.post<AuthTokenResponse>(
                `${this.SAVEHAVEN_BASE_URL}/oauth2/token`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            const { ibs_client_id, access_token, expires_in } = response.data;

            this.accessToken = access_token;
            this.ibsClientId = ibs_client_id;
            this.tokenExpiry = Date.now() + expires_in * 1000;

            return {
                access_token,
                ibs_client_id
            };

        } catch (error) {
            await logServiceError(error, 'Error generating SavaHaven access token');
            throw error;
        }
    }


    public static async createSaveHavenOfframpSettlement(offrampTransaction: SaveHavenOfframpSettlement) {

        return await this.SAVEHAVEN_OFFRAMP_TRANSACTION_REPOSITORY.create({
            localAmount: offrampTransaction.localAmount,
            usdAmount: offrampTransaction.usdAmount,
            transactionFeeUsd: offrampTransaction.transactionFeeUsd,
            conversionRate: offrampTransaction.rate,
            paymentCurrency: offrampTransaction.localCurrencySymbol,
            transactionHash: offrampTransaction.transactionHash,
            processingStatus: 'pending',
            ownerId: offrampTransaction.ownerId,
            sequenceId: offrampTransaction.sequenceId,
            blockchainNetwork: offrampTransaction.blockchainNetwork,
            fromWalletAddress: offrampTransaction.fromWalletAddress,
            platformFeePercentage: offrampTransaction.platformFeePercentage,
            hotWalletAddress: offrampTransaction.hotWalletAddress,
            destinationAccountName: offrampTransaction.destination.accountName,
            destinationAccountNumber: offrampTransaction.destination.accountNumber,
            destinationNetworkName: offrampTransaction.destination.networkName,
            tokenAddress: offrampTransaction.tokenAddress,
            tokenSymbol: offrampTransaction.tokenSymbol,
            localCurrencySymbol: offrampTransaction.localCurrencySymbol,
            country: offrampTransaction.destination.country,
        });

    }


    public static async getSupportedBanks(): Promise<{ name: string; slug: string; bankCode: string }[]> {
        try {

            const authTokenData = await this.generateAccessToken();

            const response = await axios.get<SupportedBankResponse>(
                `${this.SAVEHAVEN_BASE_URL}/transfers/banks`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authTokenData.access_token}`,
                        'ClientID': `${authTokenData.ibs_client_id}`
                    },
                }
            );

            const { data: banks, statusCode, message } = response.data;

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            const supportedBanks = banks.map(bank => ({
                name: bank.name,
                slug: slugify(bank.name, { lower: true, replacement: '-' }),
                bankCode: bank.bankCode
            }));

            return supportedBanks;

        } catch (error) {
            await logServiceError(error, 'Error fetching supported banks from SavaHaven');
            throw error;
        }
    }

    public static async accountNameEnquiry(params: { bankCode: string, accountNumber: string }) {
        try {

            const { bankCode, accountNumber } = params;

            const authTokenData = await this.generateAccessToken();

            const result = accountNameEnquirySchema.safeParse(params);

            if (!result.success) {
                throw new HttpException(BAD_REQUEST, `${result.error.message}`);
            }

            const payload = {
                bankCode: bankCode,
                accountNumber: accountNumber
            }

            const response = await axios.post<BankAccountVerificationResponse>(
                `${this.SAVEHAVEN_BASE_URL}/transfers/name-enquiry`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authTokenData.access_token}`,
                        'ClientID': `${authTokenData.ibs_client_id}`
                    },
                }
            );

            const { data, statusCode, message } = response.data;

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            return {
                sessionId: data.sessionId,
                bankCode: data.bankCode,
                accountNumber: data.accountNumber,
                accountName: data.accountName
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
                        'Authorization': `Bearer ${authTokenData.access_token}`,
                        'ClientID': `${authTokenData.ibs_client_id}`
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
        sessionId: string,
        beneficiaryBankCode: string,
        amountToSend: number,
        beneficiaryAccountNumber: string
    }) {
        try {

            const { sessionId, beneficiaryBankCode, amountToSend, beneficiaryAccountNumber } = params;

            const authTokenData = await this.generateAccessToken();

            const payload = {
                saveBeneficiary: true,
                nameEnquiryReference: sessionId,
                debitAccountNumber: this.SAVEHAVEN_ACCOUNT_NUMBER,
                beneficiaryBankCode: beneficiaryBankCode,
                beneficiaryAccountNumber: beneficiaryAccountNumber,
                amount: amountToSend,
                narration: "AZZA",
                paymentReference: ManualOfframpSettlementService.generateSequenceId(`${sessionId}`, 'safehaven')
            }

            const response = await axios.post(
                `${this.SAVEHAVEN_BASE_URL}/transfers`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authTokenData.access_token}`,
                        'ClientID': `${authTokenData.ibs_client_id}`
                    },
                }
            );

            const { data, statusCode, message } = response.data;

            void logger.info(`Processing safehaven off-ramp transaction of ${amountToSend} NGN to beneficiary account: ${beneficiaryAccountNumber}, Session ID: ${sessionId}`);

            if (statusCode != OK) throw new HttpException(statusCode, `${message}`);

            void logger.info(`Successfully sent ${amountToSend} NGN to beneficiary account: ${beneficiaryAccountNumber}, Session ID: ${sessionId}`);


        } catch (error) {
            await logServiceError(error, 'Error processing safehaven Off-Ramp Transaction');
            throw error;
        }
    }


}

export default SafeHaveService