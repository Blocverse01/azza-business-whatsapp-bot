import { dbClient } from '@/db/dbClient';
import { RegisterReferralInput } from './schema';

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
        }).select(['*', 'referee.*', 'referralScheme.*']).getFirst();
    }

    public static async createReferralCode(params: { code: string, userId: string }) {
        return await this.REFERRAL_SCHEME_REPOSITORY.create({
            code: params.code,
            user: params.userId,
        });
    }
}

export default ReferralSchemeService;
