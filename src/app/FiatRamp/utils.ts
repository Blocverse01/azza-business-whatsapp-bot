import { dbClient } from "@/db/dbClient";

export const getFallBackRegionalPhoneNumber = async(userId:string, countryCode: string) => {
    const record = await dbClient.fallback_regional_phone_number.filter({
        user: userId,
        countryCode
    }).getFirst();

    if(!record) {
        return null;
    }

    return record.phoneNumber;
}