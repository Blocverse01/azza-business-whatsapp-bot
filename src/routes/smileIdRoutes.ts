import SmileIdController from '@/app/SmileID/SmileIdController';
import express from 'express';
const smileIdRoutes = express.Router();

smileIdRoutes.post('/webhook', SmileIdController.receiveWebhook);

// Test endpoint
smileIdRoutes.get('/test', (req, res) => {
    res.status(200).send('Smile ID routes are working!');
});

export default smileIdRoutes;
