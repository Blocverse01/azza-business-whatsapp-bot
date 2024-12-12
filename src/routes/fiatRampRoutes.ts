import express from 'express';
import FiatRampServiceController from '@/app/FiatRamp/FiatRampServiceController';

const fiatRampRouter = express.Router();

fiatRampRouter.post('/webhook/payment/:state', FiatRampServiceController.offRampWebWebhook);

export default fiatRampRouter;
