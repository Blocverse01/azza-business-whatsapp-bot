import { AssetInteractiveButtonIds, ExploreAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';

export const SELL_BENEFICIARY_AMOUNT_PATTERN =
    /sell:(?<sell>[^|]+)\|beneficiaryId:(?<beneficiaryId>[^|]+)\|amount:(?<amount>\d+)/;

export const SELL_ASSET_TO_BENEFICIARY_REGEX_PATTERN =
    /sell:(?<sell>[^|]+)\|beneficiaryId:(?<beneficiaryId>[^|]+)/;

// create a regex pattern from `sell:${assetId}|beneficiaryAction:chooseExisting`
export const SELL_ASSET_DESTINATION_CHOICE_REGEX =
    /sell:(?<assetId>[^|]+)\|beneficiaryAction:(?<beneficiaryAction>[^|]+)\|countryCode:(?<countryCode>[^|]+)/;

// create a regex pattern for `${assetActionId}:${purchaseAssetId}|currency:${country.currency}|countryCode:${country.code}`
export const TRADE_ASSET_REGEX =
    /(?<assetActionId>[^:]+):(?<purchaseAssetId>[^|]+)\|currency:(?<currency>[^|]+)\|countryCode:(?<countryCode>[^|]+)/;

export const BOT_COMMANDS_REGEX = {
    RATES: /^\/rates$/,
    SELL_ASSET: /^\/sell\s+(?<asset>\w+)\s+(?<network>\w+)$/, // e.g /sell usdt polygon
    BUY_ASSET: /^\/buy\s+(?<asset>\w+)\s+(?<network>\w+)$/, // e.g /buy usdt polygon
    ASSETS_MENU: /^\/my_assets$/,
    HELP: /^\/help$/,
    TRANSFER: /^\/withdraw\s+(?<asset>\w+)\s+(?<network>\w+)$/,
    DEPOSIT: /^\/deposit\s+(?<asset>\w+)\s+(?<network>\w+)$/,
    BALANCES: /^\/balance$/, // matches /balance,
    ASSET_BALANCE: /^\/balance\s+(?<asset>\w+)\s+(?<network>\w+)$/, // /balance <asset> <network>
    ENTITY_BALANCE: /^\/balance\s+(?<entity>\w+)$/, // /balance <asset> or /balance <network>
    RESET_PIN: /^\/reset_pin$/,
    CHANGE_PIN: /^\/change_pin$/,
    PERFORM_KYC: /^\/verify_me$/,
    SUPPORT: /^\/support$/,
    WRAPPED: /^\/wrapped$/,
    REFERRAL_CODE:/^\/referral_code$/,
};

export type SellAssetToBeneficiaryMatchGroups = {
    sell: string;
    beneficiaryId: string;
};

export type SellAssetDestinationChoiceMatchGroups = {
    assetId: string;
    beneficiaryAction: 'chooseExisting' | 'addNew';
    countryCode: string;
};

export type TradeAssetMatchGroups = {
    assetActionId: Extract<ExploreAssetActions, 'buy' | 'sell'>;
    purchaseAssetId: AssetInteractiveButtonIds;
    currency: string;
    countryCode: string;
};

export type TradeAssetBotCommandMatchGroups = {
    asset: string;
    network: string;
};

// generic function for extracting any regex groups, with a type parameter
export const extractGroups = <T extends Record<string, string>>(text: string, regex: RegExp): T => {
    const match = text.match(regex);

    if (!match) {
        throw new Error('Invalid command');
    }

    return match.groups as T;
};

export const extractSellAssetDestinationChoiceGroups = (text: string) => {
    return extractGroups<SellAssetDestinationChoiceMatchGroups>(
        text,
        SELL_ASSET_DESTINATION_CHOICE_REGEX
    );
};

export const extractSellAssetToBeneficiaryGroups = (
    text: string
): SellAssetToBeneficiaryMatchGroups => {
    return extractGroups<SellAssetToBeneficiaryMatchGroups>(
        text,
        SELL_ASSET_TO_BENEFICIARY_REGEX_PATTERN
    );
};

export const extractTradeAssetGroups = (text: string): TradeAssetMatchGroups => {
    return extractGroups<TradeAssetMatchGroups>(text, TRADE_ASSET_REGEX);
};

export const extractTradeAssetBotCommandGroups = (
    text: string,
    regex: RegExp
): TradeAssetBotCommandMatchGroups => {
    return extractGroups<TradeAssetBotCommandMatchGroups>(text, regex);
};

export const matchAndExtractTradeAssetBotCommandGroups = (
    text: string,
    regex: RegExp
): TradeAssetBotCommandMatchGroups | null => {
    const match = text.match(regex);

    if (!match) {
        return null;
    }

    return match.groups as TradeAssetBotCommandMatchGroups;
};
