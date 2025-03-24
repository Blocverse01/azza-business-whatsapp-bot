import { convertAsciiStringToBase64 } from '@/resources/utils/encryption';
import { Template, TemplateMessageBase } from './core/schema';

const HEADER_IMAGE_URL =
    'https://res.cloudinary.com/dltnruk3l/image/upload/f_auto,q_auto/xqvshr8nlfchabryhya7';
const TEMPLATE_NAME: Template['name'] = 'bvn_kyc_reminder';

type ComposeBvnKycReminderMessageParams = {
    userId: string;
    userPhoneNumber: string;
};
export const composeBvnKycReminderMessage = (
    params: ComposeBvnKycReminderMessageParams
): TemplateMessageBase => {
    const encodedUserId = convertAsciiStringToBase64(params.userId);

    return {
        messaging_product: 'whatsapp',
        to: params.userPhoneNumber,
        recipient_type: 'individual',
        type: 'template',
        template: {
            name: TEMPLATE_NAME,
            language: {
                code: 'en',
            },
            components: [
                {
                    type: 'header',
                    parameters: [
                        {
                            type: 'image',
                            image: {
                                link: HEADER_IMAGE_URL,
                            },
                        },
                    ],
                },
                {
                    type: 'button',
                    sub_type: 'flow',
                    index: '0',
                    parameters: [
                        {
                            type: 'action',
                            action: {
                                flow_action_data: {
                                    user_id: encodedUserId,
                                },
                            },
                        },
                    ],
                },
            ],
        },
    };
};
