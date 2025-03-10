import { Request, Response } from 'express';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import SmileIdService from './SmileIdService';
import { BAD_REQUEST } from '@/constants/status-codes';
import { SmileIdWebhookData } from './SmileIdService';

class SmileIdController {
    public static async receiveWebhook(request: Request, response: Response) {
        try {
            console.log('🔍 Received Smile ID webhook request:', {
                method: request.method,
                path: request.path,
                headers: request.headers,
            });

            // Log raw body first
            console.log('📦 Raw Webhook Body:', request.body);

            // Basic validation
            if (!request.body) {
                console.log('❌ No body in request');
                return response.status(BAD_REQUEST).json({
                    error: 'No body in request',
                });
            }

            // Send immediate 200 response as recommended by Smile ID
            response.sendStatus(200);

            // Transform webhook data to match our expected format
            const webhookData: SmileIdWebhookData = {
                partner_id: request.body.partner_id,
                job_id: request.body.job_id,
                user_id: request.body.partner_params?.user_id,
                job_type: request.body.job_type,
                job_status: request.body.job_status,
                job_success: request.body.job_success,
                signature: request.body.signature,
                timestamp: request.body.timestamp,
                result: {
                    ResultCode: request.body.result?.ResultCode || request.body.ResultCode,
                    ResultText: request.body.result?.ResultText || request.body.ResultText,
                    IsFinalResult: request.body.result?.IsFinalResult || true,
                    Actions: {
                        Verify_ID_Number: {
                            ResultType: request.body.result?.ResultType || 'ID Verification',
                            ResultText: request.body.result?.ResultText || request.body.ResultText,
                            ResultCode: request.body.result?.ResultCode || request.body.ResultCode,
                            IsFinalResult: request.body.result?.IsFinalResult || true,
                            Status: request.body.job_success ? 'VERIFIED' : 'UNVERIFIED',
                        },
                    },
                },
            };

            // Log the verification attempt
            console.log('🚀 Processing verification for:', {
                userId: webhookData.user_id,
                jobId: webhookData.job_id,
                jobStatus: webhookData.job_status,
                jobType: webhookData.job_type,
                timestamp: webhookData.timestamp,
            });

            // Process webhook
            await SmileIdService.handleWebhookEvent(webhookData);

            console.log('✅ Successfully processed webhook for user:', webhookData.user_id);
        } catch (error) {
            console.error('❌ Error in Smile ID webhook:', error);
            handleRequestError(error, response, true);
        }
    }
}

export default SmileIdController;
