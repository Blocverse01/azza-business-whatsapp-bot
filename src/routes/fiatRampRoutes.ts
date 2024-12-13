import express from 'express';
import FiatRampServiceController from '@/app/FiatRamp/FiatRampServiceController';

const fiatRampRouter = express.Router();

fiatRampRouter
    .post('/webhook/payment/:state', FiatRampServiceController.offRampWebWebhook)
    .post('/webhook/collection/:state', FiatRampServiceController.onRampWebWebhook);

export default fiatRampRouter;
