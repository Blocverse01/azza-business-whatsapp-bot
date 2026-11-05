import { Request, Response } from 'express';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { logSync } from '@/resources/logger';

class SafeHavenController {
    public static async receiveWebhook(request: Request, response: Response) {
        try {
            response.sendStatus(200); // webhook received

            const body = (request.body ?? {}) as Record<string, unknown>;
            const nested =
                body.data && typeof body.data === 'object'
                    ? (body.data as Record<string, unknown>)
                    : {};

            logSync('info', 'SafeHaven webhook received', {
                id: body.id ?? nested.id,
                sessionId: body.sessionId ?? nested.sessionId,
                paymentReference: body.paymentReference ?? nested.paymentReference,
            });
        } catch (error) {
            handleRequestError(error, response, true);
        }
    }
}

export default SafeHavenController;
