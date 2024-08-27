const APP_NAME = 'Azza';

export enum WhatsAppMessageType {
    TEXT = 'text',
    STICKER = 'sticker',
    INTERACTIVE = 'interactive',
    // Add more message types here as needed (e.g., IMAGE, VIDEO, AUDIO, etc.)
}

interface WhatsAppMessageBase {
    messaging_product: 'whatsapp';
    recipient_type: 'individual';
    to: string; // Replace with actual phone number type
}

export interface WhatsAppInteractiveButton {
    type: 'reply';
    reply: {
        id: string;
        title: string;
    };
}

export interface WhatsAppInteractiveMessage extends WhatsAppMessageBase {
    type: 'interactive';
    interactive: {
        type: 'button' | 'list' | 'flow';
        body: {
            text: string;
        };
        header?: {
            type: string;
            text: string;
        };
        footer?: {
            text: string;
        };
        action: {
            buttons?: WhatsAppInteractiveButton[];
            button?: string;
            sections?: Array<{
                rows: Array<{
                    id: string;
                    title: string;
                    description?: string;
                }>;
            }>;
            name?: string;
            parameters?: {
                flow_message_version: string;
                flow_token: string;
                flow_id: string;
                flow_cta: string;
                flow_action: 'navigate' | 'data_exchange';
                mode?: 'draft' | 'published';
                flow_action_payload: {
                    screen: string;
                    data: Record<string, unknown>;
                };
            };
        };
    };
}

export interface WhatsAppTextMessage extends WhatsAppMessageBase {
    type: WhatsAppMessageType.TEXT;
    text: {
        preview_url: boolean;
        body: string;
    };
}

export enum BaseInteractiveButtonIds {
    CREATE_WALLET = 'create-wallet',
}

export enum AssetInteractiveButtonIds {
    ETH_BASE = 'eth-base',
    MATIC_POLYGON = 'matic-polygon',

    // StableCoins
    USDC_BASE = 'usdc-base',

    USDC_POLYGON = 'usdc-polygon',
    USDT_POLYGON = 'usdt-polygon',

    USDC_ETH = 'usdc-eth',
    USDT_ETH = 'usdt-eth',

    USDC_OPTIMISM = 'usdc-optimism',
    USDT_OPTIMISM = 'usdt-optimism',

    USDT_TRON = 'usdt-tron',
}

export enum ExploreAssetActions {
    BUY_ASSET = 'buy',
    DEPOSIT = 'deposit',
    WITHDRAW_ASSET = 'withdraw',
    SELL_ASSET = 'sell',
}

export const assetInteractiveButtonsIds = Object.values(AssetInteractiveButtonIds);

export const exploreAssetActions = Object.values(ExploreAssetActions);

const actions = exploreAssetActions.join('|');
export const assetIds = assetInteractiveButtonsIds.join('|');

// Create the regex pattern
export const ASSET_ACTION_REGEX_PATTERN = `^(${actions}):(${assetIds})$`;

// Create the regex object
export const ASSET_ACTION_REGEX = new RegExp(ASSET_ACTION_REGEX_PATTERN);

export const RATES_COMMAND = 'rates';

type AssetAction = {
    text: string;
    action: ExploreAssetActions;
    description: string;
};

export const manageAssetActions: Array<AssetAction> = [
    {
        text: 'Buy With Fiat',
        action: ExploreAssetActions.BUY_ASSET,
        description: 'Buy crypto asset with your local currency',
    },
    {
        text: 'Deposit From Wallet',
        action: ExploreAssetActions.DEPOSIT,
        description: `Deposit crypto asset from a wallet outside ${APP_NAME}`,
    },
    {
        text: 'Withdraw To Wallet',
        action: ExploreAssetActions.WITHDRAW_ASSET,
        description: `Send crypto asset to a wallet outside ${APP_NAME}`,
    },
    {
        text: 'Sell',
        action: ExploreAssetActions.SELL_ASSET,
        description: 'Convert crypto asset to your local currency',
    },
];

export type InteractiveButtonReplyTypes =
    | 'create-wallet'
    | 'explore-asset'
    | 'sell-asset-destination-choice';
export type InteractiveListReplyTypes =
    | 'explore-asset-action'
    | 'trade-asset-with-currency'
    | 'explore-asset'
    | 'trigger-offramp-flow'
    | 'return-more-currencies';
export type InteractiveNfmReplyActions = 'trigger-offramp-flow';

export type AssetActionRegexMatch = [string, ExploreAssetActions, AssetInteractiveButtonIds];

export const MORE_CURRENCIES_COMMAND_REGEX_PATTERN = `^moreCurrencies\\|(${actions}):(${assetIds})\\|nextSliceFrom:(\\d+)\\|nextSliceTo:(\\d+)$`;
export const MORE_CURRENCIES_COMMAND_REGEX = new RegExp(MORE_CURRENCIES_COMMAND_REGEX_PATTERN);

export type MoreCurrenciesCommandMatch = [
    string,
    Extract<ExploreAssetActions, 'buy' | 'sell'>,
    AssetInteractiveButtonIds,
    string,
    string,
];

export type DecryptedFlowDataExchange = {
    decryptedBody: Record<string, unknown> & {
        version: string;
        action: 'ping' | 'INIT' | 'data_exchange';
        data?: Record<string, unknown> & {
            error?: unknown;
        };
    };
    aesKeyBuffer: Buffer;
    initialVectorBuffer: Buffer;
};

export type DataExchangeResponse = {
    version: string;
    data: Record<string, unknown>;
    screen?: string;
};

export type FlowNfmReplyResponse<T = Record<string, unknown>> = T & {
    wa_flow_response_params?: {
        flow_id: string;
        flow_name: string;
    };
};

export type TriggerOfframpFromAddBeneficiaryActionParams = {
    action: InteractiveNfmReplyActions;
    data: {
        assetId: string;
        beneficiaryId: string;
    };
};

export type PhoneNumberParams = { userPhoneNumber: string; businessPhoneNumberId: string };
