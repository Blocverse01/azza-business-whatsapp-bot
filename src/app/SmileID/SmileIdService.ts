import env from '@/constants/env';
import { Signature, Utilities } from 'smile-identity-core';
import axios from 'axios';
import {
    BvnKycVerificationWebhookBody,
    IN_REVIEW_RESULT_CODES,
    KycWebhookResultCode,
    REJECTED_RESULT_CODES,
    SmileIdWebhookData,
    VERIFIED_RESULT_CODES,
} from './smile-id-schema';
import { getIdList } from './country-id-types';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import logger from '@/resources/logger';
import { KycStatus } from '../User/userSchema';
import { HttpException } from '@/resources/exceptions/HttpException';
import { INTERNAL_SERVER_ERROR } from '@/constants/status-codes';
import { addKycEventJobToQueue } from './queue-utils';
import { generateRandomHexString } from '@/resources/utils/encryption';

interface GenerateSmileLinkResponse {
    link: string;
    ref_id: string;
}

export const BVN_VERIFICATION_JOB_ID_PREFIX = 'bvn_verify_';
export interface BvnVerificationDataType {
    dob: string;
    first_name: string;
    gender: string;
    last_name: string;
    phone_number: string;
    id_number: string;
    middle_name?: string;
}

const PRODUCTION_SID = '1';
class SmileIdService {
    private static readonly API_URL = env.SMILE_ID_BASE_URL;
    private static readonly PARTNER_ID = env.SMILE_ID_PARTNER_ID;
    private static readonly API_KEY = env.SMILE_ID_PROD_API_KEY;
    private static readonly CALLBACK_URL = env.SMILE_ID_WEBHOOK_URL;
    private static readonly JOB_TYPES = {
        KYC: 5,
        BVN_VERIFICATION: 1,
    };

    private static getSignature() {
        return new Signature(this.PARTNER_ID, this.API_KEY);
    }

    private static getUtilities() {
        return new Utilities(this.PARTNER_ID, this.API_KEY, PRODUCTION_SID);
    }

    public static async verifyBvnAsync(
        userId: string,
        verificationData: BvnVerificationDataType
    ): Promise<{ success: boolean }> {
        try {
            const signature = this.getSignature();
            const timestamp = new Date().toISOString();
            const signatureResponse = signature.generate_signature(timestamp);

            const payload = {
                callback_url: this.CALLBACK_URL,
                partner_id: this.PARTNER_ID,
                timestamp,
                signature: signatureResponse.signature,
                source_sdk: 'rest_api',
                source_sdk_version: '1.0.0',
                country: 'NG',
                id_type: 'BVN',
                id_number: verificationData.id_number,
                dob: verificationData.dob,
                first_name: verificationData.first_name,
                gender: verificationData.gender,
                last_name: verificationData.last_name,
                phone_number: verificationData.phone_number,
                middle_name: verificationData.middle_name,
                partner_params: {
                    job_type: this.JOB_TYPES.BVN_VERIFICATION.toString(), // BVN verification job type
                    job_id: `${BVN_VERIFICATION_JOB_ID_PREFIX}${generateRandomHexString(8)}`,
                    user_id: userId,
                },
            };

            const response = await axios.post<{
                success: boolean;
            }>(`${this.API_URL}/v1/async_id_verification`, payload, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            return response.data;
        } catch (error: any) {
            throw error;
        }
    }

    public static async generateKycLink(userId: string): Promise<string> {
        try {
            const signature = this.getSignature();
            const timestamp = new Date().toISOString();
            const signatureResponse = signature.generate_signature(timestamp);

            const payload = {
                partner_id: this.PARTNER_ID,
                timestamp,
                signature: signatureResponse.signature,
                name: `KYC Verification for ${userId}`,
                company_name: 'UseAzza LTD',
                id_types: getIdList(),
                callback_url: this.CALLBACK_URL,
                data_privacy_policy_url: 'https://www.useazza.com/UseAzza-Data-Privacy-Policy.pdf',
                logo_url: 'https://www.useazza.com/_next/static/media/logo.f40d592a.svg',
                is_single_use: true,
                redirect_url: 'https://wa.me/13025016052',
                user_id: userId,
                partner_params: {
                    user_id: userId,
                },
                expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes from now
            };

            const response = await axios.post<GenerateSmileLinkResponse>(
                `${this.API_URL}/v1/smile_links`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            return response.data.link;
        } catch (error) {
            await logServiceError(error, 'Error generating KYC link');
            throw error;
        }
    }

    public static async handleWebhookEvent(
        webhookData: SmileIdWebhookData | BvnKycVerificationWebhookBody
    ) {
        try {
            const signature = this.getSignature();

            // Verify webhook signature
            const isValidSignature = signature.confirm_signature(
                webhookData.timestamp,
                webhookData.signature
            );
            if (!isValidSignature) {
                throw new Error('Invalid webhook signature');
            }

            await addKycEventJobToQueue(webhookData);
        } catch (error) {
            logger.error('❌ Error processing Smile ID webhook:', {
                error,
            });

            throw error;
        }
    }

    public static async getJobStatus(userId: string, jobId: string) {
        const response = await this.getUtilities().get_job_status(userId, jobId, {
            return_history: true,
        });

        return response as {
            history: Array<SmileIdWebhookData>;
        };
    }

    public static gradeKycActions(resultCode: string): {
        status: KycStatus;
        message: string;
    } {
        if (REJECTED_RESULT_CODES.includes(resultCode as KycWebhookResultCode)) {
            return {
                status: 'rejected',
                message: '❌ Invalid ID number/unclear selfie photo',
            };
        }

        if (IN_REVIEW_RESULT_CODES.includes(resultCode as KycWebhookResultCode)) {
            return {
                status: 'in_review',
                message: '⏺️ Your biometric info is being reviewed',
            };
        }

        if (VERIFIED_RESULT_CODES.includes(resultCode as KycWebhookResultCode)) {
            return {
                status: 'verified',
                message: '✅ KYC verification complete',
            };
        }

        throw new HttpException(INTERNAL_SERVER_ERROR, 'Unhandled KYC action results state', {
            resultCode: resultCode,
        });
    }
}

export default SmileIdService;
