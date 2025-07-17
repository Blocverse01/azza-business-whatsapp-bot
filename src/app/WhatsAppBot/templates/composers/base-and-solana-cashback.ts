import { dbClient } from '@/db/dbClient';
import { Template, TemplateMessageBase } from '../core/schema';

const HEADER_IMAGE_URL =
    'https://res.cloudinary.com/dltnruk3l/image/upload/v1752743822/IMG_1841_amnt4z.png';
const TEMPLATE_NAME: Template['name'] = 'cash_back_solana_and_base';

export const START_KYC_QUICK_REPLY_PAYLOAD = 'Verify-Me-Button';
export const SELL_NOW_QUICK_REPLY_PAYLOAD = 'Base-Solana-Cb-Sell-Now';
export const BUY_NOW_QUICK_REPLY_PAYLOAD = 'Base-Solana-Cb-Buy-Now';

type ComposeCashbackOnBaseAndSolanaMessageParams = {
    userPhoneNumber: string;
};

const $composeCashbackOnBaseAndSolanaMessage = (
    params: ComposeCashbackOnBaseAndSolanaMessageParams
): TemplateMessageBase => {
    const buttons: TemplateMessageBase['template']['components'] = [{
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [
            {
                type: 'payload',
                payload: BUY_NOW_QUICK_REPLY_PAYLOAD,
            },
        ],
    }, {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [
                {
                    type: 'payload',
                    payload: SELL_NOW_QUICK_REPLY_PAYLOAD,
                },
            ],
        }, {
        type: 'button',
        sub_type: 'quick_reply',
        index: '2',
        parameters: [
            {
                type: 'payload',
                payload: START_KYC_QUICK_REPLY_PAYLOAD,
            },
        ],
    }];

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
                ...buttons
            ],
        },
    };
};

export const $BaseAndSolanaCashbackTemplateMessage = {
    composer: $composeCashbackOnBaseAndSolanaMessage,
    name: TEMPLATE_NAME,
    getDefaultTargetRecipients: async () => {
        return await dbClient.user_v2.getAll();
    },
};
