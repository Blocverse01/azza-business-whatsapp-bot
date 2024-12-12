import { convertBase64ToAsciiString } from '@/resources/utils/encryption';
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
    WA_PHONE_NUMBER_ID: notEmptyStringSchema('WA_PHONE_NUMBER_ID').and(
        z.nativeEnum(PHONE_NUMBER_IDS)
    ),
    WA_FLOW_PRIVATE_KEY: notEmptyStringSchema('WA_FLOW_PRIVATE_KEY'),
    WA_FLOW_PRIVATE_KEY_SEED_PHRASE: notEmptyStringSchema('WA_FLOW_PRIVATE_KEY_SEED_PHRASE'),
    TRANSACTION_FEE_RECIPIENT: notEmptyStringSchema('TRANSACTION_FEE_RECIPIENT'),
    CRYPTO_PAYOUT_AUTHORIZER_PRIVATE_KEY: notEmptyStringSchema(
        'CRYPTO_PAYOUT_AUTHORIZER_PRIVATE_KEY'
    ).transform((value) => convertBase64ToAsciiString(value)),
    CRYPTO_PAYOUT_AUTHORIZER_PUBLIC_KEY: notEmptyStringSchema(
        'CRYPTO_PAYOUT_AUTHORIZER_PUBLIC_KEY'
    ).transform((value) => convertBase64ToAsciiString(value)),
    CRYPTO_PAYOUT_AUTHORIZER_PASSPHRASE: notEmptyStringSchema(
        'CRYPTO_PAYOUT_AUTHORIZER_PASSPHRASE'
    ),
    SHOULD_EXECUTE_CRYPTO_PAYOUTS: z
        .enum(['true', 'false'])
        .default('false')
        .transform((data) => data === 'true'),

    ///////////////////////////
    /// Alchemy Notify
    ///////////////////////////
    ALCHEMY_AUTH_TOKEN: notEmptyStringSchema('ALCHEMY_AUTH_TOKEN'),
    ALCHEMY_NOTIFY_FORWARDER_ETH_SIGNING_KEY: notEmptyStringSchema(
        'ALCHEMY_NOTIFY_ETH_SIGNING_KEY'
    ),
    ALCHEMY_NOTIFY_FORWARDER_POLYGON_SIGNING_KEY: notEmptyStringSchema(
        'ALCHEMY_NOTIFY_POLYGON_SIGNING_KEY'
    ),
    ALCHEMY_NOTIFY_FORWARDER_BASE_SIGNING_KEY: notEmptyStringSchema(
        'ALCHEMY_NOTIFY_BASE_SIGNING_KEY'
    ),
    ALCHEMY_NOTIFY_FORWARDER_OPTIMISM_SIGNING_KEY: notEmptyStringSchema(
        'ALCHEMY_NOTIFY_OPTIMISM_SIGNING_KEY'
    ),
    //================================================================
    TESTING_GRPC_SERVICE: z
        .enum(['true', 'false'])
        .default('false')
        .transform((data) => data === 'true'),

    // RPC Provider Keys
    ANKR_PROJECT_KEY: z.string().optional().default(''),
    HELIUS_API_KEY: z.string().optional().default(''),
    QUICKNODE_API_KEY: z.string().optional().default(''),
    TRON_GRID_API_KEY: z.string().optional().default(''),

    ///////////////////////////
    /// User security
    ///////////////////////////
    SECURITY_QUESTIONS_MASK_KEY: notEmptyStringSchema('SECURITY_QUESTIONS_MASK_KEY'),
    SECURITY_QUESTIONS_MASK_IV: notEmptyStringSchema('SECURITY_QUESTIONS_MASK_IV'),

    ///////////////////////////
    /// AI Agent
    ///////////////////////////
    GROQ_API_KEY: notEmptyStringSchema('GROQ_API_KEY'),
    OPENAI_API_KEY: z.string().optional().default(''),

    YC_WEBHOOK_SECRET_KEY: notEmptyStringSchema('YC_WEBHOOK_SECRET_KEY'),
});

const env = envSchema.parse(process.env);

export default env;
