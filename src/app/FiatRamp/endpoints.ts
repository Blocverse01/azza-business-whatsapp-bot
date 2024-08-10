export const FIAT_RAMPS = '/ramps-sdk';

export const GET_SUPPORTED_CURRENCIES = FIAT_RAMPS + '/get-supported-countries';
export const GET_TRANSACTION_FEE = FIAT_RAMPS + '/get-fee';
export const GET_PAYMENT_CHANNELS = FIAT_RAMPS + '/get-supported-channels';
export const GET_RATES = FIAT_RAMPS + '/get-rate';
export const GET_ALL_RATES = FIAT_RAMPS + '/get-all-rates';
export const GET_MOBILE_PROVIDERS = FIAT_RAMPS + '/get-supported-mobile-providers';
export const GET_QUOTE = FIAT_RAMPS + '/quote';

// ONRAMP (BUY CRYPTO)
export const POST_ONRAMP = FIAT_RAMPS + '/on-ramp';
export const GET_ONRAMP_TRANSACTION = FIAT_RAMPS + '/get-on-ramp-transaction';

// OFFRAMP (SELL CRYPTO)
export const POST_OFFRAMP = FIAT_RAMPS + '/off-ramp';
export const SEND_OFFRAMP_REQUEST = FIAT_RAMPS + '/offramp-request';
export const GET_BENEFICIARIES = FIAT_RAMPS + '/get-beneficiaries';
export const BENEFICIARIES = FIAT_RAMPS + '/beneficiaries';
export const CREATE_BENEFICIARY = FIAT_RAMPS + '/create-beneficiary';
export const GET_BANKS = FIAT_RAMPS + '/get-supported-banks';
export const GET_OFFRAMP_TRANSACTION = FIAT_RAMPS + '/get-off-ramp-transaction';
export const GET_HOT_WALLET_ADDRESS = FIAT_RAMPS + '/get-hot-wallet-address';
