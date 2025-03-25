import { Template, TemplateMessageBase } from './core/schema';

const HEADER_IMAGE_URL =
    'https://res.cloudinary.com/dltnruk3l/image/upload/f_auto,q_auto/uwwka58ewfqpedpamjrf';
const TEMPLATE_NAME: Template['name'] = 'cashback_on_base';

export const VERIFY_ME_QUICK_REPLY_PAYLOAD = 'Verify-Me-Button';

type ComposeCashbackOnBaseMessageParams = {
    userPhoneNumber: string;
};
export const composeCashbackOnBaseMessage = (
    params: ComposeCashbackOnBaseMessageParams
): TemplateMessageBase => {
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
                    sub_type: 'quick_reply',
                    index: '0',
                    parameters: [
                        {
                            type: 'payload',
                            payload: VERIFY_ME_QUICK_REPLY_PAYLOAD,
                        },
                    ],
                },
            ],
        },
    };
};
