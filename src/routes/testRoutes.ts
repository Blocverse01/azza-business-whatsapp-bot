import { generateRatesReceipt } from '@/app/rate-card/generators';
import {
    generateOfframpToBankRecipientReceipt,
    generateOnrampReceipt,
} from '@/app/receipts/generators';
import express from 'express';

const testRoutes = express.Router();

testRoutes.get('/test-rates', async (req, res) => {
    try {
        const imageBuffer = await generateRatesReceipt([
            { locale: 'NGN', buy: 1500, sell: 1600, code: 'NGN' },
        ]);

        // Ensure response is sent as an image
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', 'inline; filename="receipt.png"');
        res.send(Buffer.from(imageBuffer));
    } catch (error) {
        console.error('Error generating receipt:', error);
        res.status(500).json({ error: 'Failed to generate receipt' });
    }
});

export default testRoutes;
