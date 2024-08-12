import {
    AlchemyAddressActivityWebhookEvent,
    type AlchemyWebhookEvent,
} from '@/app/AlchemyNotify/webhookUtils';
import { type Request, type Response } from 'express-serve-static-core';
import { OK } from '@/constants/status-codes';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { handleRequestError } from '@/Resources/requestHelpers/handleRequestError';
import AlchemyNotifyService from '@/app/AlchemyNotify/AlchemyNotifyService';

class AlchemyNotifyController {
    public static async receiveNotification(req: Request, res: Response, network: SupportedChain) {
        try {
            res.sendStatus(OK);

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
}

export default AlchemyNotifyController;
