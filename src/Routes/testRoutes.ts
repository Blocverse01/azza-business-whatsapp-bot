import express from 'express';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { OK } from '@/constants/status-codes';
import { benchmark } from '@/Resources/utils/benchmark';
import FiatRampsRpcService from '@/app/FiatRamp/grpcService/FiatRampsRpcService';

const testRoutes = express.Router();

testRoutes
    .get('/benchmark/get-countries', async (req, res) => {
        const result = await benchmark(
            () => FiatRampService.getSupportedCurrencies(),
            () => FiatRampsRpcService.getSupportedCountries()
        );

        res.status(OK).send(result);
    })
    .get('/benchmark/rates', async (req, res) => {
        const result = await benchmark(
            () => FiatRampService.getAllRates(),
            () => FiatRampsRpcService.getRates()
        );

        res.status(OK).send(result);
    })
    .get('/benchmark/quotes', async (_, res) => {
        const result = await benchmark(
            () => FiatRampService.getQuotes('NGN', 'NG', 'offramp'),
            () => FiatRampsRpcService.getQuotes('NGN', 'NG', 'offramp')
        );

        res.status(OK).send(result);
    });

export default testRoutes;
