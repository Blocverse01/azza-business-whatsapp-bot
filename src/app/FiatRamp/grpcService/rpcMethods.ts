import { promisifyUnary } from '@/app/FiatRamp/grpcService/utils';
import { fiatramps } from '@/proto/fiatramps/v1/service';
import GetSupportedCountriesRequest = fiatramps.v1.GetSupportedCountriesRequest;
import { client } from '@/app/FiatRamp/grpcService/config';
import GetRatesRequest = fiatramps.v1.GetRatesRequest;
import GetQuotesRequest = fiatramps.v1.GetQuotesRequest;
import FiatRampsServiceClient = fiatramps.v1.FiatRampsServiceClient;

// Wrap the gRPC methods as promises
export const getSupportedCountries = promisifyUnary<
    FiatRampsServiceClient,
    GetSupportedCountriesRequest,
    fiatramps.v1.GetSupportedCountriesResponse
>(client, 'GetSupportedCountries');

export const getRates = promisifyUnary<
    FiatRampsServiceClient,
    GetRatesRequest,
    fiatramps.v1.GetRatesResponse
>(client, 'GetRates');

export const getQuotes = promisifyUnary<
    FiatRampsServiceClient,
    GetQuotesRequest,
    fiatramps.v1.GetQuotesResponse
>(client, 'GetQuotes');
