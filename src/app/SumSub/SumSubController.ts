import { Request, Response } from 'express';
import SumSubService from './SumSubService';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { webhookPayloadDigestSchema } from '@/app/SumSub/sumSubSchema';

class SumSubController {
    public static async receiveWebhook(request: Request, response: Response) {
        try {
            response.sendStatus(200); // webhook received

            const payloadDigestHeader = request.headers['x-payload-digest'];

            const payloadDigestAlgorithmHeader = request.headers['x-payload-digest-alg'];

            const validData = webhookPayloadDigestSchema.parse({
                payload: request.rawBody,
                payloadDigest: payloadDigestHeader,
                payloadDigestAlgorithm: payloadDigestAlgorithmHeader,
            });

            const validatedPayload = SumSubService.validateWebhookPayload({
                payload: validData.payload,
                payloadDigest: validData.payloadDigest,
                payloadDigestAlgorithm: validData.payloadDigestAlgorithm,
            });

            await SumSubService.handleWebhookEvent(validatedPayload);
        } catch (error) {
            handleRequestError(error, response, true);
        }
    }
}

export default SumSubController;
