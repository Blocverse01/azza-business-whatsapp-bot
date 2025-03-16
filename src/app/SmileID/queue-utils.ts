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

const NOT_AVAILABLE = 'Not Available';
const NG = 'NG';

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
    return new Worker<SmileIdWebhookData>(QueueNames.handleSmileKycWebhook, async (job) => {
        const webhookData = job.data;
        const user = await userServiceV2.getUserById(webhookData.PartnerParams.user_id);

        if (!user) {
            throw new Error('User not found');
        }

        const kycResult = SmileIdService.gradeKycActions(
            Number(webhookData.ResultCode),
            KycWebhookResultCode.SELFIE_TO_ID_CHECK_PASSED
        );

        if (kycResult.status !== 'verified') {
            const message = MessageGenerators.generateTextMessage(
                user.primaryWhatsappPhoneNumber,
                kycResult.message
            );

            await userServiceV2.updateUserInfo(user, {
                kycStatus: kycResult.status.toUpperCase(),
            });

            await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

            return kycResult;
        }

        const userData: UserIdentityInfo = {
            firstName: webhookData.FullData.firstname,
            lastName: webhookData.FullData.surname,
            country: webhookData.Country,
            phoneNumber: user.primaryWhatsappPhoneNumber,
            kycDateOfBirth: webhookData.DOB,
            kycDocumentNumber: webhookData.IDNumber,
            kycIdType: webhookData.IDType,
            address: '',
            kycStatus: webhookData.Country === NG ? 'in_review' : 'verified',
        };

        if (webhookData.FullData.middlename) {
            userData.firstName += ` ${webhookData.FullData.middlename}`;
        }

        if (
            webhookData.Address &&
            webhookData.Address.toLowerCase() !== NOT_AVAILABLE.toLowerCase()
        ) {
            userData['address'] = webhookData.Address;
        }

        const [firstName, middleName, lastName] = webhookData.FullName.split(' ');

        if (userData.firstName.trim() === '') {
            userData.firstName = `${firstName} ${middleName}`;
        }
        if (userData.lastName.trim() === '') {
            userData.lastName = lastName;
        }

        await userServiceV2.updateUserInfo(user, userData);

        if (webhookData.Country == NG) {
            const message = BvnKycVerificationFlow.withPhoneNumberId(
                env.WA_PHONE_NUMBER_ID
            ).createBvnVerificationFlowMessage(user, {
                messageBody:
                    'One last step to complete your KYC verification. Please verify your BVN.',
                messageRecipient: user.primaryWhatsappPhoneNumber,
                flowCTA: '🔒 Verify BVN',
            });

            await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
            return message;
        }

        await WhatsAppBotService.sendWhatsappMessage(
            user.primaryWhatsappPhoneNumber,
            MessageGenerators.generateTextMessage(
                user.primaryWhatsappPhoneNumber,
                '🎉 Your KYC has been successfully verified!'
            )
        );
    });
};
