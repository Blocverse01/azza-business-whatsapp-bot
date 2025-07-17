import { composeBvnKycReminderMessage } from './composers/bvn-kyc-reminder';
import { BaseCashbackTemplateMessage } from './composers/base-cashback-reminder';
import { SolanaCashbackTemplateMessage } from './composers/solana-cashback-reminder';
import {
    $BaseAndSolanaCashbackTemplateMessage,
    BUY_NOW_QUICK_REPLY_PAYLOAD,
    SELL_NOW_QUICK_REPLY_PAYLOAD,
    START_KYC_QUICK_REPLY_PAYLOAD,
} from './composers/base-and-solana-cashback';

export {
    composeBvnKycReminderMessage,
    BaseCashbackTemplateMessage,
    SolanaCashbackTemplateMessage,
    BUY_NOW_QUICK_REPLY_PAYLOAD,
    SELL_NOW_QUICK_REPLY_PAYLOAD,
    START_KYC_QUICK_REPLY_PAYLOAD,
    $BaseAndSolanaCashbackTemplateMessage,
};
