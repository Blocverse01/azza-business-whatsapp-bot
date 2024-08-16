import { fiatramps } from '@/proto/fiatramps/v1/service';
import FiatRampsServiceClient = fiatramps.v1.FiatRampsServiceClient;
import GetSupportedCountriesRequest = fiatramps.v1.GetSupportedCountriesRequest;
import * as grpc from '@grpc/grpc-js';
import { promisifyUnary } from '@/app/FiatRamp/grpcService/utils';

const servicePort = 50051;
const internalServiceDns = 'globachain-ramps-service';
const serviceAddress = `${internalServiceDns}:${servicePort}`;

// Create a client
const client = new FiatRampsServiceClient(serviceAddress, grpc.credentials.createInsecure());

// Wrap the gRPC methods
const getSupportedCountries = promisifyUnary<
    GetSupportedCountriesRequest,
    fiatramps.v1.GetSupportedCountriesResponse
>(client, 'GetSupportedCountries');

// Make a gRPC call
// Use the wrapped method with async/await
export async function fetchSupportedCountries() {
    try {
        const request = new GetSupportedCountriesRequest();
        const response = await getSupportedCountries(request);

        return response.countries;
    } catch (error) {
        console.error('Error fetching supported countries:', error);
    }
}
