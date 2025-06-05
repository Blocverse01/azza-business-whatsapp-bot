import { Request, Response } from 'express';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';

class SafeHavenController {
    public static async receiveWebhook(request: Request, response: Response) {
        try {
            response.sendStatus(200); // webhook received

            console.log('SafeHaven Webhook Body:\n', request.body);
        } catch (error) {
            handleRequestError(error, response, true);
        }
    }
}

export default SafeHavenController;
