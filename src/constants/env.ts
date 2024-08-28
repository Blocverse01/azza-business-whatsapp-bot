import { z } from 'zod';
import 'dotenv/config';
import { PHONE_NUMBER_IDS } from '@/config/whatsAppPhoneNumbers';

const notEmptyStringSchema = (variableName: string) =>
    z.string().refine((val) => val.trim() !== '', {
        message: `Please set ${variableName} in .env`,
        path: [variableName],
    });

const envSchema = z.object({
    PORT: z.coerce.number().default(5123),
    CLOUD_API_ACCESS_TOKEN: notEmptyStringSchema('CLOUD_API_ACCESS_TOKEN'),
    WEBHOOK_VERIFY_TOKEN: notEmptyStringSchema('WEBHOOK_VERIFY_TOKEN'),
    CLOUD_API_URL: notEmptyStringSchema('CLOUD_API_URL'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_TAIL_SOURCE_TOKEN: notEmptyStringSchema('LOG_TAIL_SOURCE_TOKEN'),
    WALLET_KIT_PROJECT_ID: notEmptyStringSchema('WALLET_KIT_PROJECT_ID'),

    WALLET_KIT_API_TOKEN: notEmptyStringSchema('WALLET_KIT_API_TOKEN'),
    WALLET_KIT_API_URL: notEmptyStringSchema('WALLET_KIT_API_URL').and(z.string().url()),
    WALLET_KIT_DEVELOPER_SECRET: notEmptyStringSchema('WALLET_KIT_DEVELOPER_SECRET'),

    WALLET_KIT_MAINNET_API_TOKEN: notEmptyStringSchema('WALLET_KIT_MAINNET_API_TOKEN'),
    WALLET_KIT_MAINNET_API_URL: notEmptyStringSchema('WALLET_KIT_MAINNET_API_URL').and(
        z.string().url()
    ),
    WALLET_KIT_MAINNET_DEVELOPER_SECRET: notEmptyStringSchema(
        'WALLET_KIT_MAINNET_DEVELOPER_SECRET'
    ),

    FIAT_RAMPS_PROVIDER_API_URL: notEmptyStringSchema('FIAT_RAMPS_PROVIDER_API_URL').and(
        z.string().url()
    ),
    FIAT_RAMPS_PROVIDER_API_KEY: notEmptyStringSchema('FIAT_RAMPS_PROVIDER_API_KEY'),
    FIAT_RAMPS_PROVIDER_PROJECT_ID: notEmptyStringSchema('FIAT_RAMPS_PROVIDER_PROJECT_ID'),
    WEB3_ENVIRONMENT: z.enum(['testnet', 'mainnet']).default('testnet'),
    SUM_SUB_APP_TOKEN: notEmptyStringSchema('SUM_SUB_APP_TOKEN'),
    SUM_SUB_APP_TOKEN_SECRET: notEmptyStringSchema('SUM_SUB_APP_TOKEN_SECRET'),
    SUM_SUB_WEBHOOK_PRIVATE_KEY: notEmptyStringSchema('SUM_SUB_WEBHOOK_PRIVATE_KEY'),
    CDP_KEY_NAME: notEmptyStringSchema('CDP_KEY_NAME'),
    CDP_KEY_SECRET: notEmptyStringSchema('CDP_KEY_SECRET'),
    CDP_PROJECT_ID: notEmptyStringSchema('CDP_PROJECT_ID'),
    WA_PHONE_NUMBER_ID: notEmptyStringSchema('WA_PHONE_NUMBER_ID').and(
        z.nativeEnum(PHONE_NUMBER_IDS)
    ),
    WA_FLOW_PRIVATE_KEY: notEmptyStringSchema('WA_FLOW_PRIVATE_KEY'),
    WA_FLOW_PRIVATE_KEY_SEED_PHRASE: notEmptyStringSchema('WA_FLOW_PRIVATE_KEY_SEED_PHRASE'),
    TRANSACTION_FEE_RECIPIENT: notEmptyStringSchema('TRANSACTION_FEE_RECIPIENT'),
    CRYPTO_PAYOUT_AUTHORIZER_PRIVATE_KEY: notEmptyStringSchema(
        'CRYPTO_PAYOUT_AUTHORIZER_PRIVATE_KEY'
    ),
    CRYPTO_PAYOUT_AUTHORIZER_PUBLIC_KEY: notEmptyStringSchema(
        'CRYPTO_PAYOUT_AUTHORIZER_PUBLIC_KEY'
    ),
    CRYPTO_PAYOUT_AUTHORIZER_PASSPHRASE: notEmptyStringSchema(
        'CRYPTO_PAYOUT_AUTHORIZER_PASSPHRASE'
    ),
    SHOULD_EXECUTE_CRYPTO_PAYOUTS: z
        .enum(['true', 'false'])
        .default('false')
        .transform((data) => data === 'true'),
    ALCHEMY_NOTIFY_SIGNING_KEYS: notEmptyStringSchema('ALCHEMY_NOTIFY_SIGNING_KEYS'),
    ALCHEMY_AUTH_TOKEN: notEmptyStringSchema('ALCHEMY_AUTH_TOKEN'),
    TESTING_GRPC_SERVICE: z
        .enum(['true', 'false'])
        .default('false')
        .transform((data) => data === 'true'),
    TRON_GRID_API_KEY: z.string().optional().default(''),

    // RPC Provider Keys
    ANKR_PROJECT_KEY: z.string().optional().default(''),
    HELIUS_API_KEY: z.string().optional().default(''),
    QUICKNODE_API_KEY: z.string().optional().default(''),
});

const env = envSchema.parse(process.env);

export default env;
