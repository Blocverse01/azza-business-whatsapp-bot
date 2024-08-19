import { z } from 'zod';
import {
    BankBeneficiary,
    MobileMoneyBeneficiary,
    paymentMethodsResponseDataSchema,
    quoteSchema,
    ratesSchema,
    supportedCountry,
} from '@/app/FiatRamp/fiatRampSchema';
import { transformKeysToCamelCase } from '@/Resources/utils/transformers';
import { fiatramps } from '@/proto/fiatramps/v1/service';
import GetSupportedCountriesRequest = fiatramps.v1.GetSupportedCountriesRequest;
import {
    getBeneficiaries,
    getBeneficiary,
    getPaymentMethods,
    getQuotes,
    getRates,
    getSupportedCountries,
} from './rpcMethods';
import GetRatesRequest = fiatramps.v1.GetRatesRequest;
import { CountryCode } from 'libphonenumber-js';
import GetQuotesRequest = fiatramps.v1.GetQuotesRequest;
import { defaultAmountFixer } from '@/Resources/utils/currency';
import { HUNDRED } from '@/constants/numbers';
import GetBeneficiariesRequest = fiatramps.v1.GetBeneficiariesRequest;
import GetBeneficiaryRequest = fiatramps.v1.GetBeneficiaryRequest;
import GetPaymentMethodsRequest = fiatramps.v1.GetPaymentMethodsRequest;

class FiatRampsRpcService {
    public static async getSupportedCountries() {
        const request = new GetSupportedCountriesRequest();
        const response = await getSupportedCountries(request);

        const { countries } = response.toObject();

        if (!countries) {
            throw new Error('Invalid response');
        }

        return z.array(supportedCountry).parse(transformKeysToCamelCase(countries));
    }

    public static async getRates(targetCurrencies: string[] = []) {
        const request = new GetRatesRequest({
            target_currencies: targetCurrencies,
        });

        const response = await getRates(request);

        const { rates } = response.toObject();

        if (!rates) {
            throw new Error('Invalid Response');
        }

        return z.array(ratesSchema).parse(rates);
    }

    public static async getQuotes(
        currencySymbol: string,
        countryCode: CountryCode,
        route: 'onramp' | 'offramp'
    ) {
        const request = new GetQuotesRequest({
            country_code: countryCode,
            currency_symbol: currencySymbol,
        });

        const response = await getQuotes(request);

        const { fees, rate } = response.toObject();

        if (!fees || !rate) {
            throw new Error('Invalid response');
        }

        const quotes = quoteSchema.parse({
            fees: transformKeysToCamelCase(fees),
            rate: transformKeysToCamelCase(rate),
        });

        const txRate = route === 'onramp' ? quotes.rate.buy : quotes.rate.sell;
        const feePercentage =
            route === 'onramp' ? quotes.fees.onrampFeePercentage : quotes.fees.offrampFeePercentage;

        return {
            rate: txRate,
            fee: defaultAmountFixer(feePercentage / HUNDRED),
        };
    }

    public static async getCurrencyRates(currencySymbol: string) {
        const rates = await this.getRates([currencySymbol]);

        if (!rates[0]) {
            throw new Error(`Rate not found for currency: ${currencySymbol}`);
        }

        return rates[0];
    }

    public static async getBeneficiaries(
        ownerId: string,
        countryCode: CountryCode,
        accountType: 'bank' | 'phone' | undefined = undefined
    ) {
        const request = new GetBeneficiariesRequest({
            owner_id: ownerId,
            country_code: countryCode,
            account_type: accountType,
        });

        const response = await getBeneficiaries(request);

        if (!response.beneficiaries) {
            throw new Error('Invalid response');
        }

        return response.beneficiaries.map(this.parseBeneficiary);
    }

    private static parseBeneficiary(beneficiary: fiatramps.v1.Beneficiary) {
        const deserializedBeneficiary = beneficiary.toObject();

        if (deserializedBeneficiary.account_type === 'bank') {
            return {
                accountNumber: deserializedBeneficiary.account_number!,
                accountName: deserializedBeneficiary.account_name!,
                bankName: deserializedBeneficiary.provider_name!,
                country: transformKeysToCamelCase(deserializedBeneficiary.country),
                countryId: deserializedBeneficiary.country?.id!,
                channelId: deserializedBeneficiary.channel_id!,
                networkId: deserializedBeneficiary.network_id!,
                id: deserializedBeneficiary.id!,
            } satisfies BankBeneficiary;
        }

        const [firstName, lastName] = (deserializedBeneficiary.account_name ?? '').split(' ');

        return {
            mobileNumber: deserializedBeneficiary.account_number!,
            country: transformKeysToCamelCase(deserializedBeneficiary.country),
            countryId: deserializedBeneficiary.country?.id!,
            channelId: deserializedBeneficiary.channel_id!,
            networkId: deserializedBeneficiary.network_id!,
            id: deserializedBeneficiary.id!,
            mobileProvider: deserializedBeneficiary.provider_name!,
            mobileProviderCode: deserializedBeneficiary.provider_description!,
            firstName: firstName,
            lastName: lastName,
        } satisfies MobileMoneyBeneficiary;
    }

    public static async getBeneficiary(beneficiaryId: string) {
        const request = new GetBeneficiaryRequest({
            beneficiary_id: beneficiaryId,
        });

        const response = await getBeneficiary(request);

        return this.parseBeneficiary(response);
    }

    public static async getPaymentMethods(countryCode: CountryCode, route: 'onramp' | 'offramp') {
        const rampType = route === 'onramp' ? 'deposit' : 'withdraw';
        const request = new GetPaymentMethodsRequest({
            country_code: countryCode,
            route: rampType,
        });

        const response = await getPaymentMethods(request);

        const { channels, limits } = response.toObject();

        const parsedData = paymentMethodsResponseDataSchema.parse({
            channels: transformKeysToCamelCase(channels),
            limits: transformKeysToCamelCase(limits),
        });

        return {
            paymentChannels: parsedData.channels,
            countryFiatLimits: parsedData.limits,
        };
    }
}

export default FiatRampsRpcService;
