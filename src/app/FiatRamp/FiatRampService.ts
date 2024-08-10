import env from '@/constants/env';
import axios from 'axios';
import {
    BENEFICIARIES,
    CREATE_BENEFICIARY,
    GET_ALL_RATES,
    GET_BANKS,
    GET_BENEFICIARIES,
    GET_HOT_WALLET_ADDRESS,
    GET_MOBILE_PROVIDERS,
    GET_OFFRAMP_TRANSACTION,
    GET_ONRAMP_TRANSACTION,
    GET_PAYMENT_CHANNELS,
    GET_QUOTE,
    GET_RATES,
    GET_SUPPORTED_CURRENCIES,
    GET_TRANSACTION_FEE,
    POST_OFFRAMP,
    POST_ONRAMP,
    SEND_OFFRAMP_REQUEST,
} from '@/app/FiatRamp/endpoints';
import {
    createBeneficiaryParams,
    CreateBeneficiaryParams,
    CreateBeneficiaryResponse,
    GetAllRatesResponse,
    GetBeneficiariesResponse,
    GetBeneficiaryResponse,
    GetCurrenciesResponse,
    GetMobileProvidersResponse,
    GetPaymentMethodsResponse,
    GetQuoteResponse,
    GetRateResponse,
    GetSupportedBanksResponse,
    GetTransactionFeeResponse,
    GetTransactionStatusResponse,
    OnrampTransactionPayload,
    PostOfframpTransactionResponse,
    SendOfframpRequestPayload,
    sendOfframpRequestPayloadSchema,
    SendOfframpRequestResponse,
    SendOnrampTransactionResponse,
} from '@/app/FiatRamp/fiatRampSchema';
import { HUNDRED } from '@/constants/numbers';
import { CountryCode } from 'libphonenumber-js';
import { dbClient } from '@/Db/dbClient';
import { defaultAmountFixer } from '@/Resources/utils/currency';

class FiatRampService {
    private static API_URL = env.FIAT_RAMPS_PROVIDER_API_URL;
    private static OFF_RAMP_TEMPORARY_TRANSACTION = dbClient.OffRampTemporaryTransaction;

    public static get requiredRequestHeaders() {
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.FIAT_RAMPS_PROVIDER_API_KEY}`,
            'X-FiatRamps-Project-ID': env.FIAT_RAMPS_PROVIDER_PROJECT_ID,
        };
    }

    public static async getSupportedCurrencies() {
        const requestUrl = this.API_URL + GET_SUPPORTED_CURRENCIES;

        const response = await axios.get<GetCurrenciesResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        return response.data.data;
    }

    public static async getTransactionFee(countryCode: CountryCode, route: 'onramp' | 'offramp') {
        const requestUrl = `${this.API_URL}${GET_TRANSACTION_FEE}?country=${countryCode}`;

        const response = await axios.get<GetTransactionFeeResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        const fees = response.data.data;

        if (route === 'onramp') {
            return defaultAmountFixer(fees.onrampFeePercentage / HUNDRED);
        }

        return defaultAmountFixer(fees.offrampFeePercentage / HUNDRED);
    }

    public static async getAllRates() {
        const requestUrl = `${this.API_URL}${GET_ALL_RATES}`;

        const response = await axios.get<GetAllRatesResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        return response.data.data;
    }

    public static async getMultipleRates(targetCurrencies: Array<string> = []) {
        const allRates = await this.getAllRates();

        return targetCurrencies.length > 0
            ? allRates.filter((rate) => targetCurrencies.includes(rate.code))
            : allRates;
    }

    public static async getRates(currencySymbol: string) {
        const requestUrl = `${this.API_URL}${GET_RATES}?currency=${currencySymbol}`;

        const response = await axios.get<GetRateResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        return response.data.data;
    }

    public static async getBuyRate(currencySymbol: string) {
        return (await this.getRates(currencySymbol)).buy;
    }

    public static async getSellRate(currencySymbol: string) {
        return (await this.getRates(currencySymbol)).sell;
    }

    public static async getQuotes(
        currencySymbol: string,
        countryCode: CountryCode,
        route: 'onramp' | 'offramp'
    ) {
        const queryParams = new URLSearchParams({
            currency: currencySymbol,
            country: countryCode,
        });
        const endpoint = `${this.API_URL}${GET_QUOTE}?${queryParams.toString()}`;
        const response = await axios.get<GetQuoteResponse>(endpoint);

        const data = response.data.data;

        const rate = route === 'onramp' ? data.rate.buy : data.rate.sell;
        const feePercentage =
            route === 'onramp' ? data.fees.onrampFeePercentage : data.fees.offrampFeePercentage;

        return {
            rate,
            fee: defaultAmountFixer(feePercentage / HUNDRED),
        };
    }

    public static async getPaymentMethods(countryCode: CountryCode, route: 'onramp' | 'offramp') {
        const rampType = route === 'onramp' ? 'deposit' : 'withdraw';
        const requestUrl = `${this.API_URL}${GET_PAYMENT_CHANNELS}?country=${countryCode}&rampType=${rampType}`;

        const response = await axios.get<GetPaymentMethodsResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        const limits = response.data.data.limits;

        return {
            paymentChannels: response.data.data.channels,
            countryFiatLimits: limits,
        };
    }

    public static formatPaymentMethodName(channelName: string, route: 'onramp' | 'offramp') {
        if (route === 'onramp') {
            return channelName === 'bank' ? 'Bank Transfer' : 'Mobile Money';
        }
        return channelName === 'bank' ? 'Bank Account' : 'Mobile Money Account';
    }

    public static async getSupportedMobileProviders(channelId: string) {
        const requestUrl = `${this.API_URL}${GET_MOBILE_PROVIDERS}?channelId=${channelId}`;

        const response = await axios.get<GetMobileProvidersResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        return response.data.data;
    }

    public static async postOnRampTransaction(transactionPayload: OnrampTransactionPayload) {
        const requestUrl = `${this.API_URL}${POST_ONRAMP}`;

        const response = await axios.post<SendOnrampTransactionResponse>(
            requestUrl,
            transactionPayload,
            {
                headers: this.requiredRequestHeaders,
            }
        );

        const responseData = response.data.data;

        return {
            ...responseData,
            bankInfo: responseData.bankInfo
                ? {
                      accountName: responseData.bankInfo.accountName,
                      accountNumber: responseData.bankInfo.accountNumber,
                      bankName: responseData.bankInfo.name,
                  }
                : undefined,
        };
    }

    public static async getSupportedBanks(channelId: string) {
        const requestUrl = `${this.API_URL}${GET_BANKS}?channelId=${channelId}`;

        const response = await axios.get<GetSupportedBanksResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        return response.data.data;
    }

    public static async createBeneficiary(
        ownerId: string,
        countryCode: CountryCode,
        accountType: 'bank' | 'phone',
        params: CreateBeneficiaryParams
    ) {
        const requestUrl = `${this.API_URL}${CREATE_BENEFICIARY}`;
        const validatedParams = createBeneficiaryParams(accountType, countryCode).parse(params);

        const {
            beneficiary: { countryId, ...other },
        } = validatedParams;

        const response = await axios.post<CreateBeneficiaryResponse>(
            requestUrl,
            {
                ownerId,
                accountType,
                beneficiary: other,
                countryId: countryId,
            },
            {
                headers: this.requiredRequestHeaders,
            }
        );

        return response.data.beneficiaryId;
    }

    public static async getBeneficiaries(
        ownerId: string,
        countryCode: CountryCode,
        accountType: 'bank' | 'phone' | undefined = undefined
    ) {
        const requestQueryParams = new URLSearchParams({
            ownerId,
            country: countryCode,
        });

        if (accountType) {
            requestQueryParams.append('accountType', accountType);
        }

        const requestUrl = `${this.API_URL}${GET_BENEFICIARIES}?${requestQueryParams.toString()}`;

        const response = await axios.get<GetBeneficiariesResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        return response.data.data;
    }

    public static async getBeneficiary(beneficiaryId: string) {
        const requestUrl = `${this.API_URL}${BENEFICIARIES}/${beneficiaryId}`;

        const response = await axios.get<GetBeneficiaryResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        return response.data.data;
    }

    public static async sendOfframpRequest(params: SendOfframpRequestPayload) {
        const requestUrl = `${this.API_URL}${SEND_OFFRAMP_REQUEST}`;
        const validatedParams = sendOfframpRequestPayloadSchema.parse(params);

        const response = await axios.post<SendOfframpRequestResponse>(requestUrl, validatedParams, {
            headers: this.requiredRequestHeaders,
        });

        return response.data.data.offrampRequestId;
    }

    public static async postOfframpTransaction(params: SendOfframpRequestPayload) {
        const requestUrl = `${this.API_URL}${POST_OFFRAMP}`;
        const validatedParams = sendOfframpRequestPayloadSchema.parse(params);

        const response = await axios.post<PostOfframpTransactionResponse>(
            requestUrl,
            validatedParams,
            {
                headers: this.requiredRequestHeaders,
            }
        );

        return response.data.data.sequenceId;
    }

    public static async getTransactionStatus(sequenceId: string, route: 'onramp' | 'offramp') {
        const baseEndpoint = route === 'onramp' ? GET_ONRAMP_TRANSACTION : GET_OFFRAMP_TRANSACTION;
        const requestUrl = `${this.API_URL}${baseEndpoint}?sequenceId=${sequenceId}`;

        const response = await axios.get<GetTransactionStatusResponse>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        return response.data.data.transactionStatus;
    }

    public static async getHotWalletForNetwork(networkType: 'evm') {
        const requestUrl = `${this.API_URL}${GET_HOT_WALLET_ADDRESS}?networkType=${networkType}`;

        const response = await axios.get<{ data: string }>(requestUrl, {
            headers: this.requiredRequestHeaders,
        });

        const hotWalletAddress = response.data.data;

        if (!hotWalletAddress) throw new Error('Hot wallet address not found');

        return hotWalletAddress;
    }

    public static async storeOffRampTemporaryTransaction(
        userId: string,
        usdAmount: number,
        beneficiaryId: number
    ) {
        const data = await this.getOffRampTemporaryTransaction(userId);

        if (data) {
            //  const record = this.OFF_RAMP_TEMPORARY_TRANSACTION.create({
            //      "beneficiaryId": beneficiaryId,
            //      "usdAmount": usdAmount,
            //  });
            // await this.OFF_RAMP_TEMPORARY_TRANSACTION.create({
            //     beneficiaryId: "string",
            //     user: "rec_xyz",
            //     usdAmount: 2.5,
            //     status: "string",
            // });
        }
    }

    public static async getOffRampTemporaryTransaction(userId: string) {
        const record = this.OFF_RAMP_TEMPORARY_TRANSACTION.filter({
            'user.id': userId,
            $any: [{ status: 'failed' }, { status: 'complete' }],
        }).getFirst();

        return !!record;
    }
}

export default FiatRampService;
