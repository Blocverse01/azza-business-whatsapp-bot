import HoneyCoinController from '@/app/HoneyCoin/HoneyCoinController';
import express from 'express';
const honeyCoinRoutes = express.Router();

honeyCoinRoutes.post('/webhook', HoneyCoinController.offRampWebWebhook);
export default honeyCoinRoutes;
