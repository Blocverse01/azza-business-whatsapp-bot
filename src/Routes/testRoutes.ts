import express from 'express';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { formatDateDifference } from '@grpc/grpc-js/build/src/deadline';
import { fetchSupportedCountries } from '@/app/FiatRamp/grpcService/config';

const testRoutes = express.Router();

testRoutes.get('/benchmark/get-countries', async (req, res) => {
    const startTime1 = new Date();
    const supportedCountriesOverHttp = await FiatRampService.getSupportedCurrencies();
    console.log({ supportedCountriesOverHttp });
    console.log({
        timeTakenForHTTPRequest: formatDateDifference(startTime1, new Date()),
    });

    const startTime2 = new Date();
    const supportedCountriesOverGRPC = await fetchSupportedCountries();
    console.log({ supportedCountriesOverGRPC });
    console.log({
        timeTakenForGRPCRequest: formatDateDifference(startTime2, new Date()),
    });
});

export default testRoutes;
