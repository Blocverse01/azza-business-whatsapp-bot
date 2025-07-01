const APP_NAME = 'Azza';

export enum WhatsAppMessageType {
    TEXT = 'text',
    STICKER = 'sticker',
    INTERACTIVE = 'interactive',
    BUTTON = 'button'
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

export interface WhatsAppMediaMessage extends WhatsAppMessageBase {
    type: 'image';
    image?: {
        id?: string;
        link?: string;
        caption?: string;
    };
}

export interface WhatsAppCtaUrlButtonMessage extends WhatsAppMessageBase {
    type: 'interactive';
    interactive: {
        type: 'cta_url';
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
            name: 'cta_url';
            parameters: {
                display_text: string;
                url: string;
            };
        };
    };
}

export enum BaseInteractiveButtonIds {
    CREATE_WALLET = 'create-wallet',
    REFERRAL_STATS = 'referral-stats',
}

export enum AssetInteractiveButtonIds {
    ETH_BASE = 'eth-base',
    ETH_OPTIMISM = 'eth-optimism',
    OP_OPTIMISM = 'op-optimism',
    POL_POLYGON = 'pol-polygon',
    ETH_ETHEREUM = 'eth-ethereum',
    ETH_ARBITRUM = 'eth-arbitrum',
    ETH_LISK = 'eth-lisk',
    CELO_CELO = 'celo-celo',

    // StableCoins
    USDC_BASE = 'usdc-base',
    USDT_BASE = 'usdt-base',

    USDC_POLYGON = 'usdc-polygon',
    USDT_POLYGON = 'usdt-polygon',

    USDC_ETH = 'usdc-eth',
    USDT_ETH = 'usdt-eth',

    USDC_OPTIMISM = 'usdc-optimism',
    USDT_OPTIMISM = 'usdt-optimism',

    USDT_TRON = 'usdt-tron',

    USDC_SOLANA = 'usdc-solana',
    USDT_SOLANA = 'usdt-solana',

    SOL = 'sol-solana',
    TRX = 'trx-tron',

    BNB_BEP20 = 'bnb-bep20',
    USDT_BEP20 = 'usdt-bep20',
    CNGN_BEP20 = 'cngn-bep20',
    USDC_BEP20 = 'usdc-bep20',

    USDC_ASSET_CHAIN = 'usdc-asset-chain',
    USDT_ASSET_CHAIN = 'usdt-asset-chain',

    USDC_ARBITRUM = 'usdc-arbitrum',
    USDT_ARBITRUM = 'usdt-arbitrum',

    USDC_LISK = 'usdc-lisk',
    USDT_LISK = 'usdt-lisk',

    USDC_CELO = 'usdc-celo',
    USDT_CELO = 'usdt-celo',
}

export enum ExploreAssetActions {
    BUY_ASSET = 'buy',
    DEPOSIT = 'deposit',
    WITHDRAW_ASSET = 'withdraw',
    SELL_ASSET = 'sell',
    PAY = 'pay',
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
        description: `Send crypto asset to an ${APP_NAME} phone number or a wallet outside ${APP_NAME}`,
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
    | 'sell-asset-destination-choice'
    | 'acknowledge-manual-offramp-settlement'
    | 'mark-manual-offramp-settlement-as-paid'
    | 'explore-asset-action'
    | 'referral-stats';
export type InteractiveListReplyTypes =
    | 'explore-asset-action'
    | 'trade-asset-with-currency'
    | 'explore-asset'
    | 'trigger-offramp-flow'
    | 'return-more-currencies'
    | 'return-more-beneficiaries';
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

export const MORE_BENEFICIARIES_COMMAND_REGEX_PATTERN =
    /^moreBeneficiaries\|(?<assetId>[^|]+)\|(?<countryCode>\w+)\|(?<nextSliceFrom>\d+)\|(?<nextSliceTo>\d+)$/;

export type DecryptedFlowDataExchange = {
    decryptedBody: Record<string, unknown> & {
        version: string;
        action: 'ping' | 'INIT' | 'data_exchange' | 'complete';
        data?: Record<string, unknown> & {
            error?: unknown;
        };
        flow_token: string;
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

export enum ActionExecuted {
    CREATED_NEW_USER = 'CREATED_NEW_USER',
    MIGRATING_USER_WALLET = 'MIGRATING_USER_WALLET',
    FAILED_TO_CREATE_NEW_USER = 'FAILED_TO_CREATE_NEW_USER',
    SEND_CREATE_WALLET_MESSAGE = 'SEND_CREATE_WALLET_MESSAGE',
    SEND_SET_TRANSACTION_PIN_MESSAGE = 'SEND_SET_TRANSACTION_PIN_MESSAGE',
    HANDLE_BOT_COMMAND = 'HANDLE_BOT_COMMAND',
    HANDLE_RATES_MESSAGE = 'HANDLE_RATES_MESSAGE',
    SEND_ASSISTANT_REPLY = 'SEND_ASSISTANT_REPLY',
    SEND_MANAGE_ASSET_MESSAGE = 'SEND_MANAGE_ASSET_MESSAGE',
    SEND_SELL_ASSET_DESTINATION_CHOICE_MESSAGE = 'SEND_SELL_ASSET_DESTINATION_CHOICE_MESSAGE',
    SEND_OFFRAMP_FLOW_MESSAGE = 'SEND_OFFRAMP_FLOW_MESSAGE',
    SEND_ONRAMP_FLOW_MESSAGE = 'SEND_ONRAMP_FLOW_MESSAGE',
    NO_ACTION = 'NO_ACTION',
    SEND_MORE_CURRENCIES_MESSAGE = 'SEND_MORE_CURRENCIES_MESSAGE',
    SEND_TRADE_ASSET_WITH_CURRENCY_MESSAGE = 'SEND_TRADE_ASSET_WITH_CURRENCY_MESSAGE',
    SEND_SELL_ASSET_MESSAGE = 'SEND_SELL_ASSET_MESSAGE',
    SEND_BUY_ASSET_MESSAGE = 'SEND_BUY_ASSET_MESSAGE',
    SEND_DEPOSIT_ASSET_MESSAGE = 'SEND_DEPOSIT_ASSET_MESSAGE',
    SEND_WITHDRAW_ASSET_MESSAGE = 'SEND_WITHDRAW_ASSET_MESSAGE',
    ACKNOWLEDGED_MANUAL_OFFRAMP_SETTLEMENT = 'ACKNOWLEDGED_MANUAL_OFFRAMP_SETTLEMENT',
    MARK_MANUAL_OFFRAMP_SETTLEMENT_PAID = 'MARK_MANUAL_OFFRAMP_SETTLEMENT_PAID',
    SEND_MAINTAINANCE_MESSAGE = 'SEND_MAINTAINANCE_MESSAGE',
    SEND_KYC_QUERY_RESPONSE = 'SEND_KYC_QUERY_RESPONSE',
    REFERRAL_STATS = 'REFERRAL_STATS',
}

export type IncomingWhatsappMessage = {
    id: string;
    type: string;
    from: string;
    text: {
        body: string;
    };
    button?: {
        text: string;
        payload: string;
    };
    interactive: {
        type: 'button_reply' | 'list_reply' | 'nfm_reply';
        list_reply?: {
            id: string;
            title: string;
            description: string;
        };
        button_reply?: {
            id: string;
            title: string;
        };
        nfm_reply?: {
            name: 'flow';
            response_json: string;
        };
    };
};
