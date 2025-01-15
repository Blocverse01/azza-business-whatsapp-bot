import { getMasterWalletConfig } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import blockradarWebhookService from '@/app/runtime/blockradar-webhook';
import azzaWalletManager from '@/app/runtime/wallet';
import { BAD_REQUEST, OK } from '@/constants/status-codes';
import express from 'express';

const blockradarRouter = express.Router();

blockradarRouter.post('/webhooks/:network', async (req, res) => {
    const supportedNetwork = azzaWalletManager
        .getSupportedNetworks()
        .find((network) => network.toLowerCase() === req.params.network.toLowerCase());

    if (!supportedNetwork) {
        return res.status(BAD_REQUEST).send('Invalid webhook endpoint');
    }

    const masterWalletApiKey = getMasterWalletConfig(supportedNetwork).apiKey;

    const payloadIsValid = blockradarWebhookService.verifyWebhookSignature({
        signatureHeader: req.headers['x-blockradar-signature'] as string,
        payload: JSON.stringify(req.body),
        masterWalletApiKey,
    });

    if (!payloadIsValid) {
        return res.status(BAD_REQUEST).send('Invalid webhook signature');
    }

    res.sendStatus(OK);
    console.log('Request OK');

    await blockradarWebhookService.handleWebhook(req.body, supportedNetwork);
});

export default blockradarRouter;
