import { getMasterWalletConfig } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import { BAD_REQUEST, OK } from '@/constants/status-codes';
import blockradarWebhookService from '@/runtime/blockradar-webhook';
import azzaWalletManager from '@/runtime/wallet';
import express from 'express';

const blockradarRouter = express.Router();

blockradarRouter.all('/webhooks/:network', async (req, res) => {
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
    console.log('Request OK: ', req.body.event);

    await blockradarWebhookService.handleWebhook(req.body, supportedNetwork);
});

export default blockradarRouter;
