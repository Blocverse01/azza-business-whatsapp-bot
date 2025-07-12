import { dbClient } from "@/db/dbClient";
import azzaWalletManager from "@/runtime/wallet";

export const getFallBackRegionalPhoneNumber = async (userId: string, countryCode: string) => {
    const record = await dbClient.fallback_regional_phone_number.filter({
        user: userId,
        countryCode
    }).getFirst();

    if (!record) {
        return null;
    }

    return record.phoneNumber;
}

export const normalizeTxHash = (txHash: string) => {
    return txHash.split('_retry')[0];
}

export const searchSupportedBlockchain = (blockchain: string) => {
    return azzaWalletManager
        .getSupportedNetworks()
        .find(
            (chain) =>
                chain.toLowerCase() === blockchain.toLowerCase()
        );
}