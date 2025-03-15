import { Request, Response } from 'express';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { BAD_REQUEST } from '@/constants/status-codes';
import SmileIdService, { BvnVerificationDataType, SmileIdWebhookData } from './SmileIdService';

class SmileIdController {
    public static async receiveWebhook(request: Request, response: Response) {
        try {
            console.log('🔍 Received Smile ID webhook request:', {
                method: request.method,
                path: request.path,
                headers: request.headers,
            });

            const { ImageLinks, Document, Photo, FullData, ...rest} = request.body;

            const { photo, slip, ...fullData} = FullData;

            // Log raw body first
            console.log('📦 Raw Webhook Body:', {
                ...rest, 
                FullData: fullData
            });

            // Basic validation
            if (!request.body) {
                console.log('❌ No body in request');
                return response.status(BAD_REQUEST).json({
                    error: 'No body in request',
                });
            }

            // Send immediate 200 response as recommended by Smile ID
            return response.sendStatus(200);

            // Transform webhook data to match our expected format
            const webhookData: SmileIdWebhookData = {
                partner_id: request.body.partner_id,
                job_id: request.body.PartnerParams?.job_id,
                user_id: request.body.PartnerParams?.user_id,
                job_type: request.body.PartnerParams?.job_type?.toString(),
                signature: request.body.signature,
                timestamp: request.body.timestamp,
                full_name: request.body.FullName,
                verification_data: {
                    dob: request.body.DOB,
                    first_name: request.body.FullData?.firstName,
                    gender: request.body.FullData?.gender,
                    last_name: request.body.FullData?.lastName,
                    phone_number: request.body.FullData?.PhoneNumber1,
                    id_number: request.body.IDNumber,
                    middle_name: request.body.FullData?.MiddleName,
                },
            };

            // Log the verification attempt
            console.log('🚀 Processing verification for:', {
                userId: webhookData.user_id,
                jobId: webhookData.job_id,
                jobType: webhookData.job_type,
                timestamp: webhookData.timestamp,
                fullName: webhookData.full_name,
                bvnVerificationData: webhookData.verification_data,
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
