import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';

export const ANKR_BASE_MAINNET_RPC_URL = 'https://rpc.ankr.com/base';
export const ANKR_BASE_SEPOLIA_RPC_URL = 'https://rpc.ankr.com/base_sepolia';

export const TRANSFER_EVENT_TOPIC =
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const ZERO_DATA = '0x';

export const FALLBACK_USE_AZZA_ADDRESS =
    'B16, West Bridge 2 Estate, Ikota, Eti-Osa, Lagos, Nigeria';

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';

export const USD_SYMBOL = '$';

export const OFFRAMP_REQUEST_ERROR_MESSAGE =
    "An issue occurred processing your payout, we've spotted it and are resolving immediately.\n\nWe will send a message once it's resolved and auto-retry your payout in 5 - 10 mins.";

export const OFFRAMP_WITHDRAW_REFERENCE_PREFIX = 'offramp-';
export const OFFRAMP = 'offramp';
export const PIZZA_CAMPAIGN_PAYMENT_SUFFIX = '-pizza-campaign';

export const MAINTAINANCE_MESSAGE = [
    'Hello amazing user💙',
    'We’re currently performing maintenance on the AZZA bot, and during this time, transactions and conversations will be temporarily unavailable.\n',
    'This maintenance is expected to last approximately 3 hours.',
    'Stay connected with us by joining our early users’ community:',
    'https://chat.whatsapp.com/IYCiFBgpNtM1rCPhtBpv2c\n',
    'Thank you for your patience!⚡️',
].join('\n');

export const getDynamicMaintenanceMessage = (
    feature: string,
    duration: {
        length: number;
        name: string;
    }
) => {
    return [
        'Hello amazing user💙',
        `We’re currently performing maintenance on the AZZA bot and during this time, the ${feature} feature will be temporarily unavailable.\n`,
        `This maintenance is expected to last approximately ${duration.length} ${duration.name}.`,
        'Stay connected with us by joining our early users’ community:',
        'https://chat.whatsapp.com/IYCiFBgpNtM1rCPhtBpv2c\n',
        'Thank you for your patience!⚡️',
    ].join('\n');
};

export const BASE_CASHBACK_REFERENCE_PREFIX = 'base-cb-';
export const BASE_CASHBACK_REASON = 'base-cashback';

export const PIZZA_DAY_CASHBACK_REFERENCE_PREFIX = 'pizza-cb-';
export const PIZZA_DAY_CASHBACK_REASON = 'pizza-cashback';

export const CRYPTO_PAYOUT_REFERENCE_PREFIX = 'azza-pay';

export const FEE_COLLECTION_REFERENCE_PREFIX = 'fee_';
export const WITHDRAWAL_REFERENCE_PREFIX = 'withdrawal';

export const getTransactionMinimumDepositMessage = (params: {
    minimum: number;
    tokenSymbol: string;
    network: AllSupportedBlockchains;
}) => {
    const { minimum, tokenSymbol, network } = params;

    return `👋 Just a heads-up — to sell ${tokenSymbol} on ${network}, the amount needs to be worth at least $${minimum.toFixed(2)}.`;
};

export const WITHDRAWAL_UNAVAILABLE_RESPONSE =
    "ℹ️ Wallet withdrawals are paused for maintenance -- to allow us make it work better for you. We'll send an update once it's ready-to-go 💙";

export const PIZZA_CAMPAIGN_ENDED_RESPONSE =
    'ℹ️ Buy Pizza campaign has ended -- looking forward to your participation on the next one 💙';

export const SWAP_UNAVAILABLE_RESPONSE =
    "ℹ️ Swaps are paused for maintenance -- to allow us make it work better for you. We'll send an update once it's ready-to-go 💙";
