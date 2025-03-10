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
    job_status: 'COMPLETED' | 'PENDING' | 'FAILED';
    job_success: boolean;
    signature: string;
    timestamp: string;
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

interface GenerateSmileLinkResponse {
    link: string;
    ref_id: string;
}

class SmileIdService {
    private static readonly API_URL = env.SMILE_ID_BASE_URL;
    private static readonly PARTNER_ID = env.SMILE_ID_PARTNER_ID;
    private static readonly API_KEY = env.SMILE_ID_PROD_API_KEY;
    private static readonly CALLBACK_URL = env.SMILE_ID_WEBHOOK_URL;

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

            const { user_id, job_status, result } = webhookData;

            console.log('📝 Processing Smile ID webhook:', {
                userId: user_id,
                jobStatus: job_status,
                resultCode: result.ResultCode,
                resultText: result.ResultText,
                isFinalResult: result.IsFinalResult,
            });

            // Get user from database
            const user = await this.validateAndGetUser(user_id, false);
            if (!user) return;

            if (job_status === 'COMPLETED') {
                const verificationStatus = result.Actions.Verify_ID_Number.Status;

                console.log('🔍 Verification details:', {
                    status: verificationStatus,
                    type: result.Actions.Verify_ID_Number.ResultType,
                    text: result.Actions.Verify_ID_Number.ResultText,
                    code: result.Actions.Verify_ID_Number.ResultCode,
                });

                if (verificationStatus === 'VERIFIED') {
                    console.log('✅ User verified successfully:', user_id);
                    await WhatsAppBotService.sendKycVerifiedMessage(
                        user.primaryWhatsappPhoneNumber
                    );

                    // Update user KYC status
                    // await userServiceV2.updateUserInfo(user, {
                    //     kycStatus: 'VERIFIED',
                    // });
                } else {
                    console.log('❌ User verification failed:', user_id);
                    await WhatsAppBotService.sendKycRejectedMessage(
                        user.primaryWhatsappPhoneNumber
                    );

                    // Update user KYC status
                    // await userServiceV2.updateUserInfo(user, {
                    //     kycStatus: 'REJECTED',
                    // });
                }
            } else if (job_status === 'FAILED') {
                console.log('❌ Verification job failed:', user_id);
                await WhatsAppBotService.sendKycRejectedMessage(user.primaryWhatsappPhoneNumber);

                // Update user KYC status
                // await userServiceV2.updateUserInfo(user, {
                //     kycStatus: 'REJECTED',
                // });
            } else {
                console.log('⏳ Verification pending:', user_id);
                // Update user KYC status
                // await userServiceV2.updateUserInfo(user, {
                //     kycStatus: 'IN_REVIEW',
                // });
            }
        } catch (error) {
            console.error('❌ Error processing Smile ID webhook:', error);
            throw error;
        }
    }
}

export default SmileIdService;
