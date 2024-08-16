import { z } from 'zod';
import { quoteSchema, ratesSchema, supportedCountry } from '@/app/FiatRamp/fiatRampSchema';
import { transformKeysToCamelCase } from '@/Resources/utils/transformers';
import { fiatramps } from '@/proto/fiatramps/v1/service';
import GetSupportedCountriesRequest = fiatramps.v1.GetSupportedCountriesRequest;
import { getQuotes, getRates, getSupportedCountries } from './rpcMethods';
import GetRatesRequest = fiatramps.v1.GetRatesRequest;
import { CountryCode } from 'libphonenumber-js';
import GetQuotesRequest = fiatramps.v1.GetQuotesRequest;
import { defaultAmountFixer } from '@/Resources/utils/currency';
import { HUNDRED } from '@/constants/numbers';

class FiatRampsRpcService {
    public static async getSupportedCountries() {
        const request = new GetSupportedCountriesRequest();
        const response = await getSupportedCountries(request);

        const { countries } = response.toObject();

        if (!countries) {
            throw new Error('Invalid response');
        }

        console.log(
            countries,
            countries.map((country) => transformKeysToCamelCase(country))
        );

        return z
            .array(supportedCountry)
            .parse(countries.map((country) => transformKeysToCamelCase(country)));
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
}

export default FiatRampsRpcService;
