import { Request, Response } from 'express';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { BAD_REQUEST } from '@/constants/status-codes';
import SmileIdService from './SmileIdService';
import { VerificationWebhookBodySchema } from './smile-id-schema';
import logger from '@/resources/logger';

class SmileIdController {
    public static async receiveWebhook(request: Request, response: Response) {
        try {
            // Basic validation
            if (!request.body) {
                logger.error('❌ No body in request');
                return response.status(BAD_REQUEST).json({
                    error: 'No body in request',
                });
            }

            // Send immediate 200 response as recommended by Smile ID
            response.sendStatus(200);

            const bodyDataValidation = VerificationWebhookBodySchema.safeParse(request.body);

            if (!bodyDataValidation.success) {
                await logger.debug(`Invalid webhook payload`, {
                    errors: bodyDataValidation.error.flatten().fieldErrors,
                });
                return;
            }

            // Process webhook
            await SmileIdService.handleWebhookEvent(bodyDataValidation.data);

            console.log(
                '✅ Successfully processed webhook for user:',
                bodyDataValidation.data.PartnerParams.user_id
            );
        } catch (error) {
            console.error('❌ Error in Smile ID webhook:', error);
            handleRequestError(error, response, true);
        }
    }
}

export default SmileIdController;
