import { dbClient } from '@/db/dbClient';
import { Template, TemplateMessageBase } from './core/schema';

const HEADER_IMAGE_URL =
    'https://res.cloudinary.com/dltnruk3l/image/upload/v1752527353/Coupon_Code_Solana-_Gradient-Updated-Trade_hwwj6a.png';
const TEMPLATE_NAME: Template['name'] = 'cash_back_solana_v2';

export const START_KYC_QUICK_REPLY_PAYLOAD = 'Verify-Me-Button';
export const TRADE_NOW_QUICK_REPLY_PAYLOAD = 'Solana-Cb-Trade-Now';

type ComposeCashbackOnSolanaMessageParams = {
    userPhoneNumber: string;
};

const composeCashbackOnSolanaMessage = (
    params: ComposeCashbackOnSolanaMessageParams
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
                            payload: TRADE_NOW_QUICK_REPLY_PAYLOAD,
                        },
                    ],
                },
                {
                    type: 'button',
                    sub_type: 'quick_reply',
                    index: '1',
                    parameters: [
                        {
                            type: 'payload',
                            payload: START_KYC_QUICK_REPLY_PAYLOAD,
                        },
                    ],
                },
            ],
        },
    };
};

export const SolanaCashbackTemplateMessage = {
    composer: composeCashbackOnSolanaMessage,
    name: TEMPLATE_NAME,
    getDefaultTargetRecipients: async () => {
        return await dbClient.user_v2
            .getAll();
    },
};
