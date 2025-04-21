import { dbClient } from "@/db/dbClient";
import { RegisterReferralInput } from "./schema";

class ReferralSchemeService {
    private static readonly REFERRALS_REPOSOSITORY = dbClient.referrals;
    private static readonly REFERRAL_SCHEME_REPOSITORY = dbClient.referral_scheme;

    public static async registerReferral(params: RegisterReferralInput) {
        return await this.REFERRALS_REPOSOSITORY.create({
            referee: params.refereeId,
            referralScheme: params.referralSchemeId
        });
    }

    public static async getReferralSchemeByCode(code: string) {
        if(code.trim() === '')  {
            return null;
        }
        
        return await this.REFERRAL_SCHEME_REPOSITORY.filter({
            code,
        }).getFirst();
    }
}

export default ReferralSchemeService;