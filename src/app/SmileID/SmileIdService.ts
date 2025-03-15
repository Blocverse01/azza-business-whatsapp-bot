import WhatsAppBotService from '../WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import userServiceV2 from '@/runtime/user';
import { Signature } from 'smile-identity-core';
import axios from 'axios';
import { UserV2Record } from '@/db/xata';

export interface SmileIdWebhookData {
    partner_id: string;
    job_id: string;
    user_id: string;
    job_type: string;
    signature: string;
    timestamp: string;
    full_name: string;
    verification_data?: BvnVerificationDataType;
}

interface GenerateSmileLinkResponse {
    link: string;
    ref_id: string;
}

interface VerifyBvnResponse {
    job_id: string;
    job_status: string;
    job_type: string;
    result: {
        ResultCode: string;
        ResultText: string;
        IsFinalResult: boolean;
        Actions: {
            Verify_ID_Number: {
                ResultType: string;
                ResultText: string;
                ResultCode: string;
                IsFinalResult: boolean;
                Status: 'VERIFIED' | 'UNVERIFIED' | 'PENDING';
            };
        };
    };
}

export interface BvnVerificationDataType {
    dob: string;
    first_name: string;
    gender: string;
    last_name: string;
    phone_number: string;
    id_number: string;
    middle_name?: string;
}

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

    private static async validateAndGetUser(
        userId: string,
        shouldThrow = true
    ): Promise<UserV2Record | null> {
        const user = await userServiceV2.getUserById(userId);
        if (!user?.primaryWhatsappPhoneNumber) {
            console.error('❌ User not found or no phone number:', userId);
            if (shouldThrow) {
                throw new Error(`User not found or no phone number: ${userId}`);
            }
            return null;
        }
        return user;
    }

    public static async verifyBvnAsync(
        userId: string,
        verificationData: BvnVerificationDataType
    ): Promise<VerifyBvnResponse> {
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
                    job_id: `bvn_verify_${Date.now()}`,
                    user_id: userId,
                },
            };

            console.log('🔄 Initiating async BVN verification with payload:', {
                ...payload,
                signature: `${signatureResponse.signature.substring(0, 10)}...`,
                id_number: `${verificationData.id_number.substring(0, 4)}...`,
                first_name: verificationData.first_name,
                last_name: `${verificationData.last_name.charAt(0)}...`,
                phone_number: `${verificationData.phone_number.substring(0, 4)}...`,
            });

            const response = await axios.post<VerifyBvnResponse>(
                `${this.API_URL}/v1/async_id_verification`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            console.log('✅ BVN verification request submitted:', {
                userId,
                jobId: response.data.job_id,
                jobStatus: response.data.job_status,
            });

            return response.data;
        } catch (error: any) {
            console.error('❌ Error initiating BVN verification:', {
                message: error.message,
                // status: error.response?.status,
                // statusText: error.response?.statusText,
                // reason: error.response?.data?.error,
            });
            throw error;
        }
    }

    public static async generateKycLink(userId: string): Promise<string> {
        try {
            const signature = this.getSignature();
            const timestamp = new Date().toISOString();
            const signatureResponse = signature.generate_signature(timestamp);
            const user = await this.validateAndGetUser(userId);

            const payload = {
                partner_id: this.PARTNER_ID,
                timestamp,
                signature: signatureResponse.signature,
                name: `KYC Verification for ${userId}`,
                company_name: 'UseAzza LTD',
                id_types: [
                    {
                        country: 'NG',
                        id_type: 'BVN',
                        verification_method: 'enhanced_kyc',
                    },
                    {
                        country: 'NG',
                        id_type: 'NIN_SLIP',
                        verification_method: 'enhanced_kyc',
                    },
                    {
                        country: 'NG',
                        id_type: 'PASSPORT',
                        verification_method: 'doc_verification',
                    },
                ],
                callback_url: this.CALLBACK_URL,
                data_privacy_policy_url: 'https://www.useazza.com/UseAzza-Data-Privacy-Policy.pdf',
                logo_url: 'https://www.useazza.com/_next/static/media/logo.f40d592a.svg',
                is_single_use: true,
                user_id: userId,
                partner_params: {
                    user_id: userId,
                },
                expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes from now
            };
            if (user) {
                await WhatsAppBotService.sendKycLinkGeneratingMessage(
                    user.primaryWhatsappPhoneNumber
                );
            }
            console.log('🔄 Generating Smile Link with payload:', {
                ...payload,
                signature: `${signatureResponse.signature}`,
            });

            const response = await axios.post<GenerateSmileLinkResponse>(
                `${this.API_URL}/v1/smile_links`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            console.log('✅ Smile Link generated successfully:', {
                userId,
                refId: response.data.ref_id,
                link: response.data.link,
            });

            return response.data.link;
        } catch (error: any) {
            console.error('❌ Error generating Smile Link:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                reason: error.response?.data.error,
            });
            throw error;
        }
    }

    private static async handleBvnVerificationWebhook(webhookData: SmileIdWebhookData) {
        // Log the entire webhook body
        console.log('📝 BVN Verification Webhook Response:', {
            // Basic job info
            partner_id: webhookData.partner_id,
            job_id: webhookData.job_id,
            job_type: webhookData.job_type,
            timestamp: webhookData.timestamp,

            // User info
            user_id: webhookData.user_id,
            full_name: webhookData.full_name,
        });
    }

    public static async handleWebhookEvent(webhookData: SmileIdWebhookData) {
        try {
            const signature = this.getSignature();

            // Verify webhook signature
            const isValidSignature = signature.confirm_signature(
                webhookData.timestamp,
                webhookData.signature
            );
            if (!isValidSignature) {
                console.error('❌ Invalid webhook signature');
                throw new Error('Invalid webhook signature');
            }

            // Convert job_type to number for comparison
            const jobType = Number(webhookData.job_type);

            console.log(jobType, webhookData);

            // Route webhook to appropriate handler based on job type
            if (jobType === this.JOB_TYPES.KYC) {
                // KYC webhook (job type 5)
                await this.handleKycWebhook(webhookData);
            } else if (jobType === this.JOB_TYPES.BVN_VERIFICATION) {
                // BVN verification webhook (job type 1)
                await this.handleBvnVerificationWebhook(webhookData);
            } else {
                console.log('⚠️ Unknown job type:', jobType);
            }
        } catch (error) {
            console.error('❌ Error processing Smile ID webhook:', error);
            throw error;
        }
    }

    private static async handleKycWebhook(webhookData: SmileIdWebhookData) {
        const { user_id, verification_data } = webhookData;

        console.log('📝 Processing KYC webhook:', {
            userId: user_id,
        });

        try {
            if (verification_data) {
                // Initiate BVN verification
                console.log('🔄 Initiating BVN verification after KYC webhook for user:', user_id);
                await this.verifyBvnAsync(user_id, verification_data);
                console.log('✅ BVN verification initiated successfully for user:', user_id);
            } else {
                console.log('⚠️ No verification data available for BVN verification');
            }
        } catch (error) {
            console.error('❌ Error initiating BVN verification after KYC:', error);
            throw error;
        }
    }
}

export default SmileIdService;
