import { z } from 'zod';
import { ratesSchema, supportedCountry } from '@/app/FiatRamp/fiatRampSchema';
import { transformKeysToCamelCase } from '@/Resources/utils/transformers';
import { fiatramps } from '@/proto/fiatramps/v1/service';
import GetSupportedCountriesRequest = fiatramps.v1.GetSupportedCountriesRequest;
import { getRates, getSupportedCountries } from './rpcMethods';
import GetRatesRequest = fiatramps.v1.GetRatesRequest;

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
}

export default FiatRampsRpcService;
