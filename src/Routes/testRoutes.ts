import express from 'express';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { formatDateDifference } from '@grpc/grpc-js/build/src/deadline';
import { fetchSupportedCountries } from '@/app/FiatRamp/grpcService/config';
import { OK } from '@/constants/status-codes';

const testRoutes = express.Router();

testRoutes.get('/benchmark/get-countries', async (req, res) => {
    const startTime1 = new Date();
    const supportedCountriesOverHttp = await FiatRampService.getSupportedCurrencies();
    const timeTakenForHTTPRequest = formatDateDifference(startTime1, new Date());
    console.log({
        timeTakenForHTTPRequest,
        supportedCountriesOverHttp,
    });

    const startTime2 = new Date();
    const supportedCountriesOverGRPC = await fetchSupportedCountries();
    const timeTakenForGRPCRequest = formatDateDifference(startTime2, new Date());
    console.log({ supportedCountriesOverGRPC, timeTakenForGRPCRequest });

    res.status(OK).send({
        timeTakenForGRPCRequest,
        timeTakenForHTTPRequest,
    });
});

export default testRoutes;
