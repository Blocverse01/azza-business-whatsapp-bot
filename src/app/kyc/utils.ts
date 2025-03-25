import { UserV2Record } from '@/db/xata';
import { PhoneNumberParams } from '@/app/WhatsAppBot/WhatsAppBotType';
import userServiceV2 from '@/runtime/user';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';

export const handleUserKycRequest = async (
    user: UserV2Record,
    phoneParams: PhoneNumberParams
): Promise<void> => {
    const userKycStatus = userServiceV2.formatKycStatus(user.kycStatus);

    if (userKycStatus === 'verified') {
        const responseMessage = `Your KYC is already verified.`;
        await WhatsAppBotService.sendWhatsappMessage(
            phoneParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, responseMessage)
        );

        return;
    }

    if (
        userKycStatus === 'unverified' ||
        userKycStatus === 'rejected' ||
        userKycStatus === 'pending'
    ) {
        await WhatsAppBotService.sendKycVerificationUrlMessage(user, phoneParams);
        return;
    }

    if (userKycStatus === 'in_review') {
        await WhatsAppBotService.sendKycInReviewMessage(phoneParams);
        return;
    }
};
