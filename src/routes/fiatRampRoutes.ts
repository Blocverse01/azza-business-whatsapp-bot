import express from 'express';
import FiatRampServiceController from '@/app/FiatRamp/FiatRampServiceController';

const fiatRampRouter = express.Router();

fiatRampRouter.post('/transactions/webhook', FiatRampServiceController.receiveTransactionWebhook);

export default fiatRampRouter;
