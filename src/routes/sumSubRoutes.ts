import express from 'express';
import SumSubController from '@/app/SumSub/SumSubController';

const sumSubRoutes = express.Router();

sumSubRoutes.post('/webhook', SumSubController.receiveWebhook);

export default sumSubRoutes;
