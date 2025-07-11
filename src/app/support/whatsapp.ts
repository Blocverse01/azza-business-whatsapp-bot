import MessageGenerators, {
    type GenerateInteractiveButtonMessageParams,
} from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { TECHNICAL_SUPPORT_NUMBERS } from '@/config/support';

export const sendTechnicalIssueAlert = async (message: string, businessPhoneNumberId: string) => {
    const messageObjects = TECHNICAL_SUPPORT_NUMBERS.map((pNumber) => {
        return MessageGenerators.generateTextMessage(pNumber, message);
    });
    const promises = messageObjects.map((mObject) =>
        WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, mObject)
    );

    await Promise.all(promises);
};

export const sendInteractiveTechnicalIssueAlert = async (
    businessPhoneNumberId: string,
    params: Omit<GenerateInteractiveButtonMessageParams, 'recipient'>
) => {
    const messageObjects = TECHNICAL_SUPPORT_NUMBERS.map((phoneNumber) => {
        return MessageGenerators.generateInteractiveButtonMessage({
            recipient: phoneNumber,
            ...params,
        });
    });

    const promises = messageObjects.map((mObject) =>
        WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, mObject)
    );

    await Promise.all(promises);
};
