import express from 'express';
import { OK } from '@/constants/status-codes';
import { benchmark } from '@/Resources/utils/benchmark';
import FiatRampsRpcService from '@/app/FiatRamp/grpcService/FiatRampsRpcService';
import FiatRampsApiService from '@/app/FiatRamp/apiService/FiatRampsApiService';

const testRoutes = express.Router();

testRoutes
    .get('/benchmark/get-countries', async (req, res) => {
        const result = await benchmark(
            () => FiatRampsApiService.getSupportedCurrencies(),
            () => FiatRampsRpcService.getSupportedCountries()
        );

        res.status(OK).send(result);
    })
    .get('/benchmark/rates', async (req, res) => {
        const result = await benchmark(
            () => FiatRampsApiService.getAllRates(),
            () => FiatRampsRpcService.getRates()
        );

        res.status(OK).send(result);
    })
    .get('/benchmark/quotes', async (_, res) => {
        const result = await benchmark(
            () => FiatRampsApiService.getQuotes('NGN', 'NG', 'offramp'),
            () => FiatRampsRpcService.getQuotes('NGN', 'NG', 'offramp')
        );

        res.status(OK).send(result);
    })
    .get('/benchmark/payment-methods', async (_, res) => {
        const result = await benchmark(
            () => FiatRampsApiService.getPaymentMethods('NG', 'onramp'),
            () => FiatRampsRpcService.getPaymentMethods('NG', 'onramp')
        );

        res.status(OK).send(result);
    });

export default testRoutes;
