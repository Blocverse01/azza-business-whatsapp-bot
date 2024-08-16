import { z } from 'zod';
import {
    BankBeneficiary,
    MobileMoneyBeneficiary,
    quoteSchema,
    ratesSchema,
    supportedCountry,
} from '@/app/FiatRamp/fiatRampSchema';
import { transformKeysToCamelCase } from '@/Resources/utils/transformers';
import { fiatramps } from '@/proto/fiatramps/v1/service';
import GetSupportedCountriesRequest = fiatramps.v1.GetSupportedCountriesRequest;
import { getBeneficiaries, getQuotes, getRates, getSupportedCountries } from './rpcMethods';
import GetRatesRequest = fiatramps.v1.GetRatesRequest;
import { CountryCode } from 'libphonenumber-js';
import GetQuotesRequest = fiatramps.v1.GetQuotesRequest;
import { defaultAmountFixer } from '@/Resources/utils/currency';
import { HUNDRED } from '@/constants/numbers';
import GetBeneficiariesRequest = fiatramps.v1.GetBeneficiariesRequest;

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

        const { beneficiaries } = response.toObject();

        if (!beneficiaries) {
            throw new Error('Invalid response');
        }

        return beneficiaries.map((beneficiary) => {
            if (beneficiary.account_type === 'bank') {
                return {
                    accountNumber: beneficiary.account_number!,
                    accountName: beneficiary.account_name!,
                    bankName: beneficiary.provider_name!,
                    country: transformKeysToCamelCase(beneficiary.country),
                    countryId: beneficiary.country?.id!,
                    channelId: beneficiary.channel_id!,
                    networkId: beneficiary.network_id!,
                    id: beneficiary.id!,
                } satisfies BankBeneficiary;
            }

            const [firstName, lastName] = (beneficiary.account_name ?? '').split(' ');

            return {
                mobileNumber: beneficiary.account_number!,
                country: transformKeysToCamelCase(beneficiary.country),
                countryId: beneficiary.country?.id!,
                channelId: beneficiary.channel_id!,
                networkId: beneficiary.network_id!,
                id: beneficiary.id!,
                mobileProvider: beneficiary.provider_name!,
                mobileProviderCode: beneficiary.provider_description!,
                firstName: firstName,
                lastName: lastName,
            } satisfies MobileMoneyBeneficiary;
        });
    }
}

export default FiatRampsRpcService;
