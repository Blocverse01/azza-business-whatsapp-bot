import SmileIdController from '@/app/SmileID/SmileIdController';
import express from 'express';
const smileIdRoutes = express.Router();

smileIdRoutes.post('/webhook', SmileIdController.receiveWebhook);

export default smileIdRoutes;
