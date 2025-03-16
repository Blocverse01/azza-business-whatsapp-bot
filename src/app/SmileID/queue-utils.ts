import { queues } from '@/background-processing/queues';
import { KycWebhookResultCode, SmileIdWebhookData } from './smile-id-schema';
import { Worker } from 'bullmq';
import { QueueNames } from '@/background-processing/types';
import SmileIdService from './SmileIdService';
import { UserIdentityInfo } from '../User/userSchema';
import MessageGenerators from '../WhatsAppBot/MessageGenerators';
import userServiceV2 from '@/runtime/user';
import WhatsAppBotService from '../WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import BvnKycVerificationFlow from '../WhatsAppBot/WhatsAppFlows/BvnKycVerificationFlow';
import { connectionConfig } from '@/background-processing/redis-connection-config';

const NOT_AVAILABLE = 'Not Available';
const NG = 'NG';

const extractUserInfoToUpdate = (
    webhookData: SmileIdWebhookData,
    kycStatus: UserIdentityInfo['kycStatus']
): Partial<UserIdentityInfo> => {
    if (kycStatus !== 'verified') {
        return {
            kycStatus,
        };
    }

    const userInfoToUpdate: Partial<UserIdentityInfo> = {
        firstName: webhookData.FullData?.firstname,
        lastName: webhookData.FullData?.surname,
        country: webhookData.Country,
        kycDateOfBirth: webhookData.DOB,
        kycDocumentNumber: webhookData.IDNumber,
        kycIdType: webhookData.IDType,
        address: '',
        gender: webhookData.Gender,
        kycStatus: webhookData.Country === NG ? 'in_review' : 'verified',
    };

    if (webhookData.FullData?.middlename) {
        userInfoToUpdate.firstName += ` ${webhookData.FullData.middlename}`;
    }

    if (webhookData.Address && webhookData.Address.toLowerCase() !== NOT_AVAILABLE.toLowerCase()) {
        userInfoToUpdate['address'] = webhookData.Address;
    }

    const [firstName, middleName, lastName] = webhookData.FullName?.split(' ') ?? [];

    if (userInfoToUpdate.firstName?.trim() === '' && firstName) {
        userInfoToUpdate.firstName = `${firstName}` + (middleName ? ` ${middleName}` : '');
    }
    if (userInfoToUpdate.lastName?.trim() === '' && lastName) {
        userInfoToUpdate.lastName = lastName;
    }
    if (userInfoToUpdate.gender?.trim() === '' && webhookData.FullData?.gender) {
        userInfoToUpdate.gender = webhookData.FullData?.gender;
    }

    return userInfoToUpdate;
};

export const addKycEventJobToQueue = async (data: SmileIdWebhookData) => {
    return await queues.handleSmileKycWebhook.add(
        `kyc-webhook-${data.PartnerParams.user_id}`,
        data,
        {
            removeOnComplete: {
                age: 24 * 3600,
                count: 500,
            },
        }
    );
};

export const createKycEventJobWorker = () => {
    return new Worker<SmileIdWebhookData>(
        QueueNames.handleSmileKycWebhook,
        async (job) => {
            const webhookData = job.data;
            const user = await userServiceV2.getUserById(webhookData.PartnerParams.user_id);

            if (!user) {
                throw new Error('User not found');
            }

            const kycResult = SmileIdService.gradeKycActions(webhookData.ResultCode);

            if (kycResult.status !== 'verified') {
                const message = MessageGenerators.generateTextMessage(
                    user.primaryWhatsappPhoneNumber,
                    kycResult.message
                );

                const userInfoToUpdate = extractUserInfoToUpdate(webhookData, kycResult.status);

                await userServiceV2.updateUserInfo(user, userInfoToUpdate);

                await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

                return kycResult;
            }

            const jobStatus = await SmileIdService.getJobStatus(
                webhookData.PartnerParams.user_id,
                webhookData.PartnerParams.job_id
            );

            const targetHistoryItem = jobStatus.history.find(
                (item) => item.ResultCode === KycWebhookResultCode.ID_VALIDATED
            );

            if (!targetHistoryItem) {
                throw new Error('ID validation history not found!');
            }

            const userInfoToUpdate = extractUserInfoToUpdate(targetHistoryItem, kycResult.status);
            await userServiceV2.updateUserInfo(user, userInfoToUpdate);

            if (targetHistoryItem.Country === NG) {
                const message = BvnKycVerificationFlow.withPhoneNumberId(
                    env.WA_PHONE_NUMBER_ID
                ).createBvnVerificationFlowMessage(user, {
                    messageBody:
                        'One last step to complete your KYC verification. Please verify your BVN.',
                    messageRecipient: user.primaryWhatsappPhoneNumber,
                    flowCTA: 'Verify BVN',
                });

                await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
                return message;
            } else {
                await WhatsAppBotService.sendWhatsappMessage(
                    env.WA_PHONE_NUMBER_ID,
                    MessageGenerators.generateTextMessage(
                        user.primaryWhatsappPhoneNumber,
                        '🎉 Your KYC has been successfully verified!'
                    )
                );
                return {
                    userCountry: user.country,
                    kycResult,
                };
            }
        },
        {
            connection: connectionConfig,
            concurrency: 30,
        }
    );
};
