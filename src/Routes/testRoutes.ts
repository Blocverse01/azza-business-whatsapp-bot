import express from 'express';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { fetchSupportedCountries } from '@/app/FiatRamp/grpcService/config';
import { OK } from '@/constants/status-codes';
import { benchmark } from '@/Resources/utils/benchmark';

const testRoutes = express.Router();

testRoutes.get('/benchmark/get-countries', async (req, res) => {
    const result = await benchmark(
        () => FiatRampService.getSupportedCurrencies(),
        () => fetchSupportedCountries()
    );

    res.status(OK).send(result);
});

export default testRoutes;
