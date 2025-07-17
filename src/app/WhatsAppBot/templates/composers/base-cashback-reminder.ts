import { dbClient } from '@/db/dbClient';
import { Template, TemplateMessageBase } from '../core/schema';

const HEADER_IMAGE_URL =
    'https://res.cloudinary.com/dltnruk3l/image/upload/f_auto,q_auto/uwwka58ewfqpedpamjrf';
const TEMPLATE_NAME: Template['name'] = 'cashback_on_base';

export const VERIFY_ME_QUICK_REPLY_PAYLOAD = 'Verify-Me-Button';

type ComposeCashbackOnBaseMessageParams = {
    userPhoneNumber: string;
};
const composeCashbackOnBaseMessage = (
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

export const BaseCashbackTemplateMessage = {
    composer: composeCashbackOnBaseMessage,
    name: TEMPLATE_NAME,
    getDefaultTargetRecipients: async () => {
        return await dbClient.user_v2
            .filter({
                $all: [
                    {
                        'xata.createdAt': {
                            $le: new Date('2025-03-16T00:00:00.000Z'),
                        },
                    },
                    {
                        $any: [
                            {
                                kycStatus: {
                                    $any: ['rejected', 'REJECTED'],
                                },
                            },
                            {
                                $notExists: 'kycStatus',
                            },
                        ],
                    },
                    {
                        $exists: 'transactionPinHash',
                    },
                ],
            })
            .getAll();
    },
};
