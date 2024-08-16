import { promisifyUnary } from '@/app/FiatRamp/grpcService/utils';
import { fiatramps } from '@/proto/fiatramps/v1/service';
import GetSupportedCountriesRequest = fiatramps.v1.GetSupportedCountriesRequest;
import { client } from '@/app/FiatRamp/grpcService/config';
import GetRatesRequest = fiatramps.v1.GetRatesRequest;

// Wrap the gRPC methods as promises
export const getSupportedCountries = promisifyUnary<
    fiatramps.v1.FiatRampsServiceClient,
    GetSupportedCountriesRequest,
    fiatramps.v1.GetSupportedCountriesResponse
>(client, 'GetSupportedCountries');

export const getRates = promisifyUnary<
    fiatramps.v1.FiatRampsServiceClient,
    GetRatesRequest,
    fiatramps.v1.GetRatesResponse
>(client, 'GetRates');
