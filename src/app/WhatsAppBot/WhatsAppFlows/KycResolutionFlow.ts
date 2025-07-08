import { getFlowConfig } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import env from '@/constants/env';
import { WhatsAppInteractiveMessage } from '@/app/WhatsAppBot/WhatsAppBotType';
import { convertAsciiStringToBase64, generateRandomHexString } from '@/resources/utils/encryption';
import { SIXTEEN } from '@/constants/numbers';
import {
    type KycReviewResult,
    type KycInfoToReview,
} from '@/app/kyc/self-service-resolution/utils';
import WhatsAppBotService from '../WhatsAppBotService';
import MessageGenerators from '../MessageGenerators';
import { sendInteractiveTechnicalIssueAlert } from '@/app/support/whatsapp';
import redis from '@/cache/redis';
import userServiceV2 from '@/runtime/user';
import { removeExcessSpaces } from '@/resources/utils/transformers';

export interface KycFlowCompletionData {
    corrected_name: string;
    corrected_dob: string;
    selected_name_source: 'bvn_name' | 'nin_name' | 'different_name';
    selected_dob_source: 'bvn_dob' | 'nin_dob' | 'different_dob';
    reason_for_differences: string[];
    additional_info: string;
    user_id: string;
    original_bvn_name: string;
    original_nin_name: string;
    original_bvn_dob: string;
    original_nin_dob: string;
    flow_completed_at: string;
    bvn_details: {
        address: string;
        id_number: string;
    };
}

type TempKycResolutionStore = {
    storeResolutionData: (data: KycFlowCompletionData) => Promise<string>;
    getResolutionData: (id: string) => Promise<KycFlowCompletionData | null>;
};

const flowConfig = getFlowConfig('KYC_RESOLUTION', env.WA_PHONE_NUMBER_ID);

export default class KycResolutionFlow {
    public static generateKycResolutionFlowInitMessage(
        result: KycReviewResult,
        userInfo: KycInfoToReview & {
            bvn_address: string;
            bvn_number: string;
        },
        recipient: {
            id: string;
            phoneNumber: string;
        }
    ): WhatsAppInteractiveMessage {
        const { phoneNumber: userPhoneNumber, id: userId } = recipient;

        if (result.decision !== 'MANUAL_REVIEW') {
            throw new Error(
                'generateManualReviewFlowMessage should only be called for MANUAL_REVIEW decisions'
            );
        }

        // Get mismatched fields and create issue description
        const mismatchedFields = Object.entries(result.needResolution)
            .filter(([_, needsResolution]) => needsResolution)
            .map(([field, _]) => field);

        const issueDescription = (() => {
            const isNameMismatch = mismatchedFields.includes('name');
            const isDobMismatch = mismatchedFields.includes('dateOfBirth');

            if (isNameMismatch && isDobMismatch) return 'name and date of birth differences';
            if (isNameMismatch) return 'name differences';
            if (isDobMismatch) return 'date of birth differences';
            return 'information differences';
        })();

        const flowToken = generateRandomHexString(SIXTEEN);

        return {
            type: 'interactive',
            interactive: {
                type: 'flow',
                header: {
                    type: 'text',
                    text: 'Quick review needed! 🔍',
                },
                body: {
                    text: `We found ${issueDescription} between your BVN and NIN.\nHelp us verify which is correct - takes just a minute!`,
                },
                footer: {
                    text: 'Tap below to start',
                },
                action: {
                    name: 'flow',
                    parameters: {
                        flow_message_version: '3',
                        flow_token: flowToken,
                        flow_id: flowConfig.flowId,
                        mode: flowConfig.flowMode,
                        flow_cta: 'Review My Info',
                        flow_action: 'navigate',
                        flow_action_payload: {
                            screen: 'WELCOME',
                            data: {
                                bvn_name: userInfo.bvn.name,
                                nin_name: userInfo.nin.name,
                                bvn_dob: userInfo.bvn.dateOfBirth,
                                nin_dob: userInfo.nin.dateOfBirth,
                                user_id: userId,
                                diff_ratio: result.diffRatio,
                                risk_level: result.riskLevel,
                                mismatched_fields: mismatchedFields,
                                bvn_details: {
                                    address: userInfo.bvn_address,
                                    id_number: userInfo.bvn_number,
                                },
                            },
                        },
                    },
                },
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: userPhoneNumber,
        };
    }

    public static async processKycFlowCompletion(flowData: KycFlowCompletionData) {
        const user = await userServiceV2.getUserById(flowData.user_id);

        if (!user) {
            throw new Error('User not found');
        }

        const finalName = (
            {
                bvn_name: flowData.original_bvn_name,
                nin_name: flowData.original_nin_name,
                different_name: flowData.corrected_name,
            } as const
        )[flowData.selected_name_source];
        const finalDob = (
            {
                bvn_dob: flowData.original_bvn_dob,
                nin_dob: flowData.original_nin_dob,
                different_dob: flowData.corrected_dob,
            } as const
        )[flowData.selected_dob_source];

        const hasCorrections =
            flowData.selected_name_source === 'different_name' ||
            flowData.selected_dob_source === 'different_dob';

        if (!hasCorrections) {
            let [firstName, lastName, middleName] = removeExcessSpaces(finalName.trim()).split(
                /\s+/
            );

            if (firstName && middleName) {
                firstName += ` ${middleName}`;
            }

            const address = flowData.bvn_details.address ?? undefined;
            await userServiceV2.updateUserInfo(user, {
                kycStatus: 'VERIFIED',
                additionalKycIdNumber: flowData.bvn_details.id_number,
                additionalKycIdType: 'BVN',
                address: address,
                firstName: firstName.toUpperCase(),
                lastName: lastName.toUpperCase(),
                kycDateOfBirth: finalDob,
            });

            await WhatsAppBotService.sendKycVerifiedMessage(user.primaryWhatsappPhoneNumber);
            return;
        }

        const resolutionId = await this.defaultStore.storeResolutionData(flowData);

        await this.sendConfirmationMessage(user.primaryWhatsappPhoneNumber);
        await this.notifyAdmin(
            {
                name: finalName,
                dob: finalDob,
            },
            resolutionId,
            flowData,
            user.primaryWhatsappPhoneNumber
        );
    }

    public static async admin_resolveKycReview(actionButtonId: string, adminPhoneNumber: string) {
        const [, , action, reviewId] = actionButtonId.split('_'); // 'admin_kyc_approve_${resolutionId}'

        const data = await this.defaultStore.getResolutionData(reviewId);

        if (!data) {
            throw new Error('Empty data');
        }

        const user = await userServiceV2.getUserById(data.user_id);

        if (!user) {
            throw new Error('User not found');
        }

        const finalName = (
            {
                bvn_name: data.original_bvn_name,
                nin_name: data.original_nin_name,
                different_name: data.corrected_name,
            } as const
        )[data.selected_name_source];
        const finalDob = (
            {
                bvn_dob: data.original_bvn_dob,
                nin_dob: data.original_nin_dob,
                different_dob: data.corrected_dob,
            } as const
        )[data.selected_dob_source];

        let [firstName, lastName, middleName] = removeExcessSpaces(finalName.trim()).split(/\s+/);

        if (firstName && middleName) {
            firstName += ` ${middleName}`;
        }

        if (action === 'approve') {
            if(user.kycStatus?.toUpperCase() === 'VERIFIED') {
                await WhatsAppBotService.sendWhatsappMessage(
                    env.WA_PHONE_NUMBER_ID,
                    MessageGenerators.generateTextMessage(adminPhoneNumber, '✅ *KYC already Approved Successfully*')
                );
                return;
            }

            const address = data.bvn_details.address ?? undefined;
            await userServiceV2.updateUserInfo(user, {
                kycStatus: 'VERIFIED',
                additionalKycIdNumber: data.bvn_details.id_number,
                additionalKycIdType: 'BVN',
                address: address,
                firstName: firstName.toUpperCase(),
                lastName: lastName.toUpperCase(),
                kycDateOfBirth: finalDob,
            });
            await WhatsAppBotService.sendKycVerifiedMessage(user.primaryWhatsappPhoneNumber);

            const adminConfirmation = [
                '✅ *KYC Approved Successfully*',
                '',
                `User ${user.primaryWhatsappPhoneNumber} has been approved.`,
                'User notification sent.',
                '',
                'Case closed. ✓',
            ].join('\n');

            await WhatsAppBotService.sendWhatsappMessage(
                env.WA_PHONE_NUMBER_ID,
                MessageGenerators.generateTextMessage(adminPhoneNumber, adminConfirmation)
            );
            return;
        }

        if (action === 'reject') {
            if (user.kycStatus?.toUpperCase() === 'REJECTED') {
                await WhatsAppBotService.sendWhatsappMessage(
                    env.WA_PHONE_NUMBER_ID,
                    MessageGenerators.generateTextMessage(
                        adminPhoneNumber,
                        '*KYC already Rejected!*'
                    )
                );
                return;
            }
            
            await userServiceV2.updateUserInfo(user, {
                kycStatus: 'REJECTED',
            });

            const userRejectionMessage = [
                '❌ *KYC Verification Update*',
                '',
                'We were unable to verify your identity with the information provided.',
                '',
                'This may be due to:',
                '• Inconsistent information across documents',
                '• Missing or unclear documentation',
                '• Data entry errors',
                '',
                'Please use */support* to get help with resubmitting your verification.',
                '',
                'Our team is here to help you get verified! 💪',
            ].join('\n');

            await WhatsAppBotService.sendWhatsappMessage(
                env.WA_PHONE_NUMBER_ID,
                MessageGenerators.generateTextMessage(
                    user.primaryWhatsappPhoneNumber,
                    userRejectionMessage
                )
            );

            const adminConfirmation = [
                '❌ *KYC Rejected*',
                '',
                `User ${user.primaryWhatsappPhoneNumber} has been rejected.`,
                'User notification sent.',
                '',
                'Case closed. They can reapply via /support.',
            ].join('\n');

            await WhatsAppBotService.sendWhatsappMessage(
                env.WA_PHONE_NUMBER_ID,
                MessageGenerators.generateTextMessage(adminPhoneNumber, adminConfirmation)
            );
        }
    }

    private static determinePriority(flowData: KycFlowCompletionData): 'LOW' | 'MEDIUM' | 'HIGH' {
        const hasCorrections =
            flowData.selected_name_source === 'different_name' ||
            flowData.selected_dob_source === 'different_dob';

        const [nameSource, dobSource] = [
            flowData.selected_name_source.split('_')[0],
            flowData.selected_dob_source.split('_')[0],
        ];
        const hasBothMismatches = nameSource !== dobSource;

        if (hasCorrections) return 'HIGH';
        if (hasBothMismatches) return 'MEDIUM';
        return 'LOW';
    }

    private static async sendConfirmationMessage(phoneNumber: string) {
        const confirmationMessage = [
            '✅ *Review submitted successfully!*',
            '',
            'Thanks! Our team will review and get back to you within 5 - 30 minutes.',
            '',
            "You'll get an update right here on WhatsApp.",
            '',
            'Need help in the meantime? Just type */support*',
        ].join('\n');

        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            MessageGenerators.generateTextMessage(phoneNumber, confirmationMessage)
        );
    }

    private static async notifyAdmin(
        finalData: {
            name: string;
            dob: string;
        },
        resolutionId: string,
        flowData: KycFlowCompletionData,
        userPhoneNumber: string
    ): Promise<void> {
        const hasCorrections =
            flowData.selected_name_source === 'different_name' ||
            flowData.selected_dob_source === 'different_dob';

        const adminMessage = [
            '🔍 *NEW KYC MANUAL REVIEW*',
            '',
            `*User:* ${flowData.user_id}`,
            `*Phone:* ${userPhoneNumber}`,
            `*Submitted:* ${new Date().toLocaleString()}`,
            '',
            '*SELECTIONS:*',
            `Name: ${finalData.name} _(${flowData.selected_name_source})_`,
            `DOB: ${finalData.dob} _(${flowData.selected_dob_source})_`,
            '',
            '*ORIGINAL DATA:*',
            `BVN: "${flowData.original_bvn_name}" | ${flowData.original_bvn_dob}`,
            `NIN: "${flowData.original_nin_name}" | ${flowData.original_nin_dob}`,
            '',
            `*REASONS:* ${flowData.reason_for_differences.join(', ') || 'None provided'}`,
            `*NOTES:* ${flowData.additional_info || 'None provided'}`,
            '',
            `*ACTION REQUIRED:* ${hasCorrections ? 'Verify user-provided corrections' : 'Process using selected official record'}`,
        ].join('\n');

        await sendInteractiveTechnicalIssueAlert(env.WA_PHONE_NUMBER_ID, {
            bodyText: adminMessage,
            replyButtons: [
                {
                    id: `admin_kyc_approve_${resolutionId}`,
                    title: '✅ Approve KYC',
                },
                {
                    id: `admin_kyc_reject_${resolutionId}`,
                    title: '❌ Reject KYC',
                },
            ],
        });
    }

    private static get defaultStore(): TempKycResolutionStore {
        return {
            async storeResolutionData(data) {
                const key = convertAsciiStringToBase64(`kyc-issue-${data.user_id}`);
                await redis.set(key, JSON.stringify(data));

                return key;
            },
            async getResolutionData(id) {
                return JSON.parse((await redis.get(id)) ?? '{}') ?? null;
            },
        };
    }
}
