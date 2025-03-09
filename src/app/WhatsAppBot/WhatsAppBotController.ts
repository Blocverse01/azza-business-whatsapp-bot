import { receiveIncomingWhatsappMessageTemp } from '@/app/WhatsAppBot/messagingQueueHelpers';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { type IncomingWhatsappMessage } from '@/app/WhatsAppBot/WhatsAppBotType';
import env from '@/constants/env';
import { OK } from '@/constants/status-codes';
import { logSync } from '@/resources/logger';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import type { Request, Response } from 'express';

interface WebhookRequestBody {
    entry: [
        {
            changes: [
                {
                    value: {
                        metadata: {
                            phone_number_id: string;
                        };
                        messages: [IncomingWhatsappMessage];
                        contacts: [
                            {
                                profile: {
                                    name: string;
                                };
                            },
                        ];
                    };
                },
            ];
        },
    ];
}

class WhatsAppBotController {
    public static async receiveMessageWebhook(req: Request, res: Response) {
        try {
            res.sendStatus(OK);

            const messageParts = WhatsAppBotController.extractStringMessageParts(req.body);

            const { message, displayName, businessPhoneNumberId } = messageParts;

            if (message?.id) {
                void WhatsAppBotService.markMassageAsRead(businessPhoneNumberId, message.id);
            }

            if (message && message.id && businessPhoneNumberId && displayName) {
                await receiveIncomingWhatsappMessageTemp(
                    message,
                    businessPhoneNumberId,
                    displayName
                );
            } else {
                return;
            }
        } catch (error) {
            handleRequestError(error, res, true);
        }
    }

    private static extractStringMessageParts(requestBody: WebhookRequestBody) {
        const firstEntry = requestBody.entry![0] ?? undefined;

        const firstChange = firstEntry?.changes![0];

        const firstChangeValue = firstChange?.value;

        if (!firstChangeValue) {
            return {};
        }

        if (!firstChangeValue.metadata || !firstChangeValue.metadata.phone_number_id) {
            return {};
        }

        const businessPhoneNumberId = firstChangeValue.metadata.phone_number_id;

        if (!firstChangeValue.messages) {
            return {};
        }

        const message = firstChangeValue.messages[0];

        const displayName = firstChangeValue.contacts[0].profile.name;

        return { businessPhoneNumberId, message, displayName };
    }

    public static async messageWebHookVerification(req: Request, res: Response) {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        // check the mode and token sent are correct
        if (mode === 'subscribe' && token === env.WEBHOOK_VERIFY_TOKEN) {
            // respond with 200 OK and challenge token from the request
            res.status(200).send(challenge);
            logSync('info', 'Webhook verified successfully!');
        } else {
            // respond with '403 Forbidden' if verify tokens do not match
            res.sendStatus(403);
        }
    }
}

export default WhatsAppBotController;
