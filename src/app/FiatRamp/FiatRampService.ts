import env from '@/constants/env';
import {
    CreateBeneficiaryParams,
    OnrampTransactionPayload,
    SendOfframpRequestPayload,
} from '@/app/FiatRamp/fiatRampSchema';
import { CountryCode } from 'libphonenumber-js';
import FiatRampsApiService from '@/app/FiatRamp/apiService/FiatRampsApiService';
import FiatRampsRpcService from '@/app/FiatRamp/grpcService/FiatRampsRpcService';

class FiatRampService {
    private static readonly USE_API_SERVICE = false;

    public static get requiredRequestHeaders() {
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.FIAT_RAMPS_PROVIDER_API_KEY}`,
            'X-FiatRamps-Project-ID': env.FIAT_RAMPS_PROVIDER_PROJECT_ID,
        };
    }

    public static async getSupportedCurrencies() {
        if (this.USE_API_SERVICE) {
            return await FiatRampsApiService.getSupportedCurrencies();
        }

        return await FiatRampsRpcService.getSupportedCountries();
    }

    public static async getTransactionFee(countryCode: CountryCode, route: 'onramp' | 'offramp') {
        // TODO: add flag control statement
        return await FiatRampsApiService.getTransactionFee(countryCode, route);
    }

    public static async getAllRates() {
        if (this.USE_API_SERVICE) {
            return await FiatRampsApiService.getAllRates();
        }

        return await FiatRampsRpcService.getRates();
    }

    public static async getMultipleRates(targetCurrencies: Array<string> = []) {
        if (this.USE_API_SERVICE) {
            return await FiatRampsApiService.getMultipleRates(targetCurrencies);
        }

        return await FiatRampsRpcService.getRates(targetCurrencies);
    }

    public static async getCurrencyRates(currencySymbol: string) {
        if (this.USE_API_SERVICE) {
            return await FiatRampsApiService.getCurrencyRates(currencySymbol);
        }

        return await FiatRampsRpcService.getCurrencyRates(currencySymbol);
    }

    public static async getBuyRate(currencySymbol: string) {
        return (await this.getCurrencyRates(currencySymbol)).buy;
    }

    public static async getSellRate(currencySymbol: string) {
        return (await this.getCurrencyRates(currencySymbol)).sell;
    }

    public static async getQuotes(
        currencySymbol: string,
        countryCode: CountryCode,
        route: 'onramp' | 'offramp'
    ) {
        if (this.USE_API_SERVICE) {
            return await FiatRampsApiService.getQuotes(currencySymbol, countryCode, route);
        }

        return await FiatRampsRpcService.getQuotes(currencySymbol, countryCode, route);
    }

    public static async getPaymentMethods(countryCode: CountryCode, route: 'onramp' | 'offramp') {
        const args = [countryCode, route] as const;

        if (this.USE_API_SERVICE) {
            return await FiatRampsApiService.getPaymentMethods(...args);
        }

        return await FiatRampsRpcService.getPaymentMethods(...args);
    }

    public static formatPaymentMethodName(channelName: string, route: 'onramp' | 'offramp') {
        if (route === 'onramp') {
            return channelName === 'bank' ? 'Bank Transfer' : 'Mobile Money';
        }
        return channelName === 'bank' ? 'Bank Account' : 'Mobile Money Account';
    }

    public static async getSupportedMobileProviders(channelId: string) {
        // TODO: add flag control statement
        return await FiatRampsApiService.getSupportedMobileProviders(channelId);
    }

    public static async postOnRampTransaction(transactionPayload: OnrampTransactionPayload) {
        // TODO: add flag control statement
        return await FiatRampsApiService.postOnRampTransaction(transactionPayload);
    }

    public static async getSupportedBanks(channelId: string) {
        // TODO: add flag control statement
        return await FiatRampsApiService.getSupportedBanks(channelId);
    }

    public static async createBeneficiary(
        ownerId: string,
        countryCode: CountryCode,
        accountType: 'bank' | 'phone',
        params: CreateBeneficiaryParams
    ) {
        // TODO: add flag control statement
        return await FiatRampsApiService.createBeneficiary(
            ownerId,
            countryCode,
            accountType,
            params
        );
    }

    public static async getBeneficiaries(
        ownerId: string,
        countryCode: CountryCode,
        accountType: 'bank' | 'phone' | undefined = undefined
    ) {
        if (this.USE_API_SERVICE) {
            return await FiatRampsApiService.getBeneficiaries(ownerId, countryCode, accountType);
        }

        return FiatRampsRpcService.getBeneficiaries(ownerId, countryCode, accountType);
    }

    public static async getBeneficiary(beneficiaryId: string) {
        if (this.USE_API_SERVICE) {
            return await FiatRampsApiService.getBeneficiary(beneficiaryId);
        }

        return await FiatRampsRpcService.getBeneficiary(beneficiaryId);
    }

    public static async sendOfframpRequest(params: SendOfframpRequestPayload) {
        // TODO: add flag control statement
        return await FiatRampsApiService.sendOfframpRequest(params);
    }

    public static async postOfframpTransaction(params: SendOfframpRequestPayload) {
        // TODO: add flag control statement
        return await FiatRampsApiService.postOfframpTransaction(params);
    }

    public static async getTransactionStatus(sequenceId: string, route: 'onramp' | 'offramp') {
        // TODO: add flag control statement
        return await FiatRampsApiService.getTransactionStatus(sequenceId, route);
    }

    public static async getHotWalletForNetwork(networkType: 'evm') {
        // TODO: add flag control statement
        return await FiatRampsApiService.getHotWalletForNetwork(networkType);
    }
}

export default FiatRampService;
