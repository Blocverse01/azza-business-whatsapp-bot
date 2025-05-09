import { dbClient } from '@/db/dbClient';
import { RegisterReferralInput } from './schema';
import { UserV2Record } from '@/db/xata';
import { PhoneNumberParams } from '../WhatsAppBot/WhatsAppBotType';
import WhatsAppBotService from '../WhatsAppBot/WhatsAppBotService';
import MessageGenerators from '../WhatsAppBot/MessageGenerators';
import { handelReferralStats } from './queue-utils';

class ReferralSchemeService {
    private static readonly REFERRALS_REPOSITORY = dbClient.referrals;
    private static readonly REFERRAL_SCHEME_REPOSITORY = dbClient.referral_scheme;

    public static async registerReferral(params: RegisterReferralInput) {
        return await this.REFERRALS_REPOSITORY.create({
            referee: params.refereeId,
            referralScheme: params.referralSchemeId,
        });
    }

    public static async getReferralSchemeByCode(code: string) {
        if (code === null) {
            return null;
        }

        return await this.REFERRAL_SCHEME_REPOSITORY.filter({
            code: code,
        }).getFirst();
    }

    public static async getReferralSchemeByUserId(userId: string) {
        return await this.REFERRAL_SCHEME_REPOSITORY.filter({
            user: userId,
        }).getFirst();
    }

    public static async getRefereeByPhoneNumber(phoneNumber: string) {
        if (phoneNumber) {
            return null;
        }

        return await this.REFERRALS_REPOSITORY.filter({
            'referee.primaryWhatsappPhoneNumber': phoneNumber,
        })
            .select(['*', 'referee.*', 'referralScheme.*'])
            .getFirst();
    }

    public static async createReferralCode(params: { code: string; userId: string }) {
        return await this.REFERRAL_SCHEME_REPOSITORY.create({
            code: params.code,
            user: params.userId,
        });
    }

    public static async getTotalReferredByUserId(referralId: string): Promise<string> {
        const records = await this.REFERRALS_REPOSITORY.summarize({
            filter: { 'referralScheme.id': referralId },
            summaries: {
                totalReferred: { count: '*' },
            },
        });

        return records.summaries[0].totalReferred.toFixed();
    }

    public static async generateReferralStatsCard(params: {
        user: UserV2Record;
        phoneParams: PhoneNumberParams;
        displayName: string;
    }) {
        const {
            phoneParams: { businessPhoneNumberId, userPhoneNumber },
            displayName,
            user: { country, id: userId },
        } = params;

        const isNigeria = country?.includes('NG') ?? false;

        const message = isNigeria
            ? `Oya! Hold your heart! 💓, your referral stats dey load! 🧾🔥`
            : `Brace yourself! 💓 Your referral stats are loading! 🧾🔥`;

        await WhatsAppBotService.sendWhatsappMessage(
            businessPhoneNumberId,
            MessageGenerators.generateTextMessage(userPhoneNumber, message)
        );

        const totalReferred = await this.getTotalReferredByUserId(userId);

        await handelReferralStats({
            displayName: displayName,
            businessPhoneNumberId,
            userPhoneNumber,
            totalReferred: totalReferred,
            isNigeria: isNigeria,
        });
    }
}

export default ReferralSchemeService;
