import {
    AlchemyAddressActivityWebhookEvent,
    AlchemyRequest,
    type AlchemyWebhookEvent,
    isValidSignatureForAlchemyRequest,
} from '@/app/AlchemyNotify/webhookUtils';
import { type Request, type Response } from 'express';
import { BAD_REQUEST, FORBIDDEN, OK } from '@/constants/status-codes';
import { SUPPORTED_CHAINS, SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { handleRequestError } from '@/Resources/requestHelpers/handleRequestError';
import AlchemyNotifyService from '@/app/AlchemyNotify/AlchemyNotifyService';

class AlchemyNotifyController {
    private static async receiveNotification(req: Request, res: Response, network: SupportedChain) {
        try {
            const payload = req.body as AlchemyWebhookEvent;

            if (payload.type === 'ADDRESS_ACTIVITY') {
                await AlchemyNotifyService.handleAddressActivityNotification(
                    payload as AlchemyAddressActivityWebhookEvent,
                    network
                );
            }
        } catch (error) {
            handleRequestError(error, res, true);
        }
    }

    public static async notificationHandler(req: Request, res: Response) {
        const { network } = req.params;

        const isValidNetwork = SUPPORTED_CHAINS.includes(network as SupportedChain);

        if (!isValidNetwork) {
            return res.sendStatus(BAD_REQUEST);
        }

        res.sendStatus(OK);

        const networkAsSupportedChain = network as SupportedChain;
        const signingKey = AlchemyNotifyService.signingKeys[networkAsSupportedChain];

        if (!isValidSignatureForAlchemyRequest(req as AlchemyRequest, signingKey)) {
            res.status(FORBIDDEN).send('Signature validation failed, unauthorized!');
            return;
        }

        await AlchemyNotifyController.receiveNotification(req, res, network as SupportedChain);
    }
}

export default AlchemyNotifyController;
