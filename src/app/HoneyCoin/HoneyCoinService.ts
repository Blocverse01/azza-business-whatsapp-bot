import { logServiceError } from "@/resources/requestHelpers/handleRequestError";
import { AccountBalanceResponse, AuthTokenResult, ConversionResponse, EventDataType, HoneyCoinOfframpSettlement, HoneyCoinPayoutResponse, MobileProviderListResponse, SupportedBankResponse, TxType } from "./HoneyCoinSchema";
import env from "@/constants/env";
import axios from "axios";
import { HttpException } from "@/resources/exceptions/HttpException";
import slugify from "slugify";
import { INTERNAL_SERVER_ERROR, NOT_FOUND, OK } from "@/constants/status-codes";
import { OfframpTransactionRecordSchema, transactionStatusSchema } from "../FiatRamp/fiatRampSchema";
import { dbClient } from "@/db/dbClient";
import logger from "@/resources/logger";

class HoneyCoinService {

    private static readonly HONEYCOIN_BASE_URL = env.HONEYCOIN_BASE_URL;
    private static readonly HONEYCOIN_API_KEY = env.HONEYCOIN_API_KEY;
    private static readonly HONEYCOIN_PUBLIC_KEY = env.HONEYCOIN_PUBLIC_KEY;
    private static accessToken: string | null = null;
    private static tokenExpiry: number | null = null;
    private static HONEYCOIN_OFFRAMP_TRANSACTION_REPOSITORY = dbClient.honeycoin_offramp_settlement_transaction


    public static async generateAccessToken(): Promise<AuthTokenResult> {

        try {

            const currentTime = Date.now();

            if (this.accessToken && this.tokenExpiry && currentTime < this.tokenExpiry) {
                return {
                    success: true,
                    token: this.accessToken,
                };
            }

            const payload = {
                publicKey: this.HONEYCOIN_PUBLIC_KEY
            };

            const response = await axios.post<AuthTokenResult>(
                `${this.HONEYCOIN_BASE_URL}/auth/generate-bearer-token`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': this.HONEYCOIN_API_KEY
                    },
                }
            );

            const { token, success, message } = response.data;

            const ONE_HOUR_IN_MS = 60 * 60 * 1000;
            this.accessToken = token;
            this.tokenExpiry = Date.now() + ONE_HOUR_IN_MS;

            if (!success) throw new HttpException(INTERNAL_SERVER_ERROR, message as string);

            return {
                success,
                token
            };

        } catch (error) {
            await logServiceError(error, 'Error generating HoneyCoin access token');
            throw error;
        }
    }


    public static async getSupportedBanksByCountry(country: string): Promise<
        { name: string; slug: string; bankCode: string }[]
    > {
        try {
            const authTokenData = await this.generateAccessToken();

            const response = await axios.get<SupportedBankResponse>(
                `${this.HONEYCOIN_BASE_URL}/utilities/banks?country=${country}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.token}`
                    },
                }
            );

            const { data: banks, success, message } = response.data;

            if (!success) throw new HttpException(INTERNAL_SERVER_ERROR, message as string);

            const supportedBanks = banks.map((bank) => ({
                name: bank.name,
                slug: slugify(bank.name, { lower: true, replacement: '-' }),
                bankCode: bank.code,
            }));

            return supportedBanks;
        } catch (error) {
            await logServiceError(error, `Error fetching supported ${country} banks from HoneyCoin`);
            throw error;
        }
    }

    public static async getSupportedBanksByCurrency(currency: string): Promise<
        { name: string; slug: string; currency: string, country: string }[]
    > {
        try {
            const authTokenData = await this.generateAccessToken();

            const response = await axios.get<MobileProviderListResponse>(
                `${this.HONEYCOIN_BASE_URL}/utilities/banks?country=${currency}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.token}`
                    },
                }
            );

            const { data: mobileProviders, success } = response.data;

            const supportedMobileProviders = mobileProviders.map((mobileProvider) => ({
                name: mobileProvider.name,
                slug: slugify(mobileProvider.id, { lower: true, replacement: '-' }),
                currency: mobileProvider.currency,
                country: mobileProvider.countryCode
            }));

            return supportedMobileProviders;

        } catch (error) {
            await logServiceError(error, `Error fetching supported ${currency} mobileProvider from HoneyCoin`);
            throw error;
        }
    }

    public static async getHoneyCoinAccountBalance(): Promise<{ balance: number }> {

        try {

            const authTokenData = await this.generateAccessToken();

            const response = await axios.get<AccountBalanceResponse>(
                `${this.HONEYCOIN_BASE_URL}/users`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.token}`
                    }
                }
            );

            const { success, KESWallet } = response.data;

            return {
                balance: KESWallet.balance
            };

        } catch (error) {
            await logServiceError(error, 'Error getting HoneyCoin Mobile Mobile Account Balance');
            throw error;
        }
    }

    public static async getFXRate(data: { fromCurrency: string, toCurrency: string, amount: number }): Promise<
        { convertedAmount: number }
    > {

        const { fromCurrency, toCurrency, amount } = data;

        try {
            const authTokenData = await this.generateAccessToken();

            const response = await axios.get<ConversionResponse>(
                `${this.HONEYCOIN_BASE_URL}/utilities/rates?from=${fromCurrency}&to=${toCurrency}&amount=${amount}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.token}`
                    },
                }
            );

            const { data: { convertedAmount }, success, message } = response.data;

            if (!success) throw new HttpException(INTERNAL_SERVER_ERROR, message as string);

            return { convertedAmount };

        } catch (error) {
            await logServiceError(error, `Error fetching FX Rate fromCurrency ${fromCurrency} --- toCurrency ${toCurrency} from HoneyCoin`);
            throw error;
        }
    }

    public static async processMobileMoneyOffRampPaymentWithHoneyCoin(data: {
        amountToSend: number,
        beneficiaryAccountNumber: string,
        beneficiaryAccountName: string,
        sequenceId: string,
    }) {

        const {
            amountToSend,
            beneficiaryAccountNumber,
            sequenceId,
            beneficiaryAccountName
        } = data;

        const payload = {
            amount: amountToSend,
            currency: 'KES',
            country: 'KE',
            externalReference: sequenceId,
            payoutMethod: {
                accountName: beneficiaryAccountName,
                accountNumber: beneficiaryAccountNumber
            },
            destination: 'MoMo'
            // debitCurrency: 'NGN'
        };

        try {
            const authTokenData = await this.generateAccessToken();
            const response = await axios.post<HoneyCoinPayoutResponse>(
                `${this.HONEYCOIN_BASE_URL}/fiat/payout`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${authTokenData.token}`
                    },
                }
            );
            const { success, message } = response.data;
            void logger.info(
                `Processing honeycoin off-ramp transaction of ${amountToSend} KES to beneficiary account: ${beneficiaryAccountNumber}, sequenceId : ${sequenceId}`
            );
            if (!success) throw new HttpException(INTERNAL_SERVER_ERROR, message as string);
            void logger.info(
                `Successfully sent ${amountToSend} KES to beneficiary account: ${beneficiaryAccountNumber}, sequenceId: ${sequenceId}`
            );
            return {
                sequenceId
            };

        } catch (error) {
            await logServiceError(error, 'Error processing off-ramp payment with HoneyCoin');
            throw error;
        }
    }


    public static async createHoneyCoinMobileMoneyOfframpSettlement(offrampTransaction: HoneyCoinOfframpSettlement) {
        return await this.HONEYCOIN_OFFRAMP_TRANSACTION_REPOSITORY.create({
            localAmount: offrampTransaction.localAmount,
            usdAmount: offrampTransaction.usdAmount,
            transactionFeeUsd: offrampTransaction.transactionFeeUsd,
            conversionRate: offrampTransaction.rate,
            paymentCurrency: offrampTransaction.localCurrencySymbol,
            transactionHash: offrampTransaction.transactionHash,
            processingStatus: transactionStatusSchema.parse('pending'),
            ownerId: offrampTransaction.ownerId,
            referenceId: offrampTransaction.sequenceId,
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

    private static readonly typeToTxMap: Record<EventDataType, TxType> = {
        deposited: 'onramp',
        withdrew: 'offramp',
    };

    public static eventTypeIsValid(eventDataType: EventDataType, expectedTxType: TxType): boolean {
        return this.typeToTxMap[eventDataType] === expectedTxType;
    }

    public static async getHoneyCoinOfframpTransaction(referenceId: string) {

        const transaction = await this.HONEYCOIN_OFFRAMP_TRANSACTION_REPOSITORY.filter({ referenceId }).getFirst();

        if (!transaction) {
            throw new HttpException(NOT_FOUND, `HoneyCoin transaction with the referenceId : ${referenceId} not found`);
        }

        const transactionRecord = OfframpTransactionRecordSchema.parse({
            destination: {
                accountName: transaction.destinationAccountName,
                accountNumber: transaction.destinationAccountNumber,
                networkName: transaction.destinationNetworkName,
                networkId: '',
                country: transaction.country,
                accountType: 'phone',
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
            sequenceId: transaction.referenceId,
            hotWalletAddress: transaction.hotWalletAddress,
            platformFeePercentage: transaction.platformFeePercentage,
            fromWalletAddress: transaction.fromWalletAddress,
            tokenAddress: transaction.tokenAddress,
        });

        return transactionRecord;
    }

    public static async updateHoneyCoinOfframpTransactionStatus(referenceId: string, status: string) {

        const transaction = await this.HONEYCOIN_OFFRAMP_TRANSACTION_REPOSITORY.filter({ referenceId }).getFirst();

        if (!transaction) {
            throw new HttpException(NOT_FOUND, `HoneyCoin transaction with the referenceId : ${referenceId} not found`);
        }

        return await transaction.update({
            processingStatus: status
        })
    }

}


export default HoneyCoinService;