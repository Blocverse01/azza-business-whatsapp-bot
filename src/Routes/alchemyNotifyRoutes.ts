import express from 'express';
import { validateAlchemySignature } from '@/app/AlchemyNotify/webhookUtils';
import env from '@/constants/env';
import AlchemyNotifyController from '@/app/AlchemyNotify/AlchemyNotifyController';
import { BAD_REQUEST } from '@/constants/status-codes';
import { SUPPORTED_CHAINS, SupportedChain } from '@/app/WalletKit/walletKitSchema';

const alchemyNotifyRoutes = express.Router();

alchemyNotifyRoutes.post(
    '/address-activity/:network',
    validateAlchemySignature(env.ALCHEMY_NOTIFY_SIGNING_KEY),
    async (req, res) => {
        const { network } = req.params;

        if (SUPPORTED_CHAINS.includes(network as SupportedChain)) {
            await AlchemyNotifyController.receiveNotification(req, res, network as SupportedChain);
            return;
        }

        res.sendStatus(BAD_REQUEST);
    }
);

export default alchemyNotifyRoutes;
