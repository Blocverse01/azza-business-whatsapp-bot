import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import logger from '@/resources/logger';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { NextFunction, Request, Response } from 'express';

const decryptFlowDataExchange = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.body) {
        return res.status(400).send('Invalid request');
    }

    let decryptedRequest = null;
    try {
        decryptedRequest = WhatsAppBotService.decryptFlowRequest(req.body);
    } catch (err) {
        return handleRequestError(err, res);
    }

    const { aesKeyBuffer, initialVectorBuffer, decryptedBody } = decryptedRequest;

    req.decryptedFlowDataExchange = {
        decryptedBody,
        aesKeyBuffer,
        initialVectorBuffer,
    };

    // Handle health pings and error reporting
    let earlyResponse: string | undefined;

    if (req.decryptedFlowDataExchange.decryptedBody.action === 'ping') {
        earlyResponse = WhatsAppBotService.encryptFlowResponse(
            {
                version: req.decryptedFlowDataExchange.decryptedBody.version,
                data: {
                    status: 'active',
                },
            },
            {
                aesKeyBuffer,
                initialVectorBuffer,
            }
        );
    }

    if (req.decryptedFlowDataExchange.decryptedBody.data?.error) {
        void logger.warn('Received client error:', {
            errorData: req.decryptedFlowDataExchange.decryptedBody.data,
        });

        earlyResponse = WhatsAppBotService.encryptFlowResponse(
            {
                version: req.decryptedFlowDataExchange.decryptedBody.version,
                data: {
                    acknowledged: true,
                },
            },
            {
                aesKeyBuffer,
                initialVectorBuffer,
            }
        );
    }

    if (earlyResponse) {
        return res.send(earlyResponse);
    }

    next();
};

export default decryptFlowDataExchange;
