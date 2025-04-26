import SafeHavenController from '@/app/NigeriaBanks/SafeHaven/SafeHavenController';
import express from 'express';
const safeHavenRoutes = express.Router();

safeHavenRoutes.post('/webhook', SafeHavenController.receiveWebhook);
export default safeHavenRoutes;
