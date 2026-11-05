import { PHONE_NUMBER_IDS } from '@/config/whatsAppPhoneNumbers';
import { z } from 'zod';

const notEmptyStringSchema = (variableName: string) =>
    z.string().refine((val) => val.trim() !== '', {
        message: `Please set ${variableName} in .env`,
        path: [variableName],
    });

const envSchema = z.object({
    PORT: z.coerce.number().default(5123),
    CLOUD_API_ACCESS_TOKEN: notEmptyStringSchema('CLOUD_API_ACCESS_TOKEN'),
    WEBHOOK_VERIFY_TOKEN: notEmptyStringSchema('WEBHOOK_VERIFY_TOKEN'),
    META_APP_SECRET: notEmptyStringSchema('META_APP_SECRET'),
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
    WEB3_ENVIRONMENT: z.enum(['testnet', 'mainnet']).default('testnet'),
    // Blockradar address ID of the mainnet EVM offramp hot wallet (rotation). Unset = current hard-coded wallet.
    OFFRAMP_HOT_WALLET_EVM_ID: z.string().trim().optional(),
    SUM_SUB_APP_TOKEN: notEmptyStringSchema('SUM_SUB_APP_TOKEN'),
    SUM_SUB_APP_TOKEN_SECRET: notEmptyStringSchema('SUM_SUB_APP_TOKEN_SECRET'),
    SUM_SUB_WEBHOOK_PRIVATE_KEY: notEmptyStringSchema('SUM_SUB_WEBHOOK_PRIVATE_KEY'),
    WA_PHONE_NUMBER_ID: notEmptyStringSchema('WA_PHONE_NUMBER_ID').and(
        z.nativeEnum(PHONE_NUMBER_IDS)
    ),
    WA_FLOW_PRIVATE_KEY: notEmptyStringSchema('WA_FLOW_PRIVATE_KEY'),
    WA_FLOW_PRIVATE_KEY_SEED_PHRASE: notEmptyStringSchema('WA_FLOW_PRIVATE_KEY_SEED_PHRASE'),
    TRANSACTION_FEE_RECIPIENT: notEmptyStringSchema('TRANSACTION_FEE_RECIPIENT'),
    CRYPTO_PAYOUT_AUTHORIZER_KEY: notEmptyStringSchema('CRYPTO_PAYOUT_AUTHORIZER_KEY'),
    CRYPTO_PAYOUT_AUTHORIZER_IV: notEmptyStringSchema('CRYPTO_PAYOUT_AUTHORIZER_IV'),
    SHOULD_EXECUTE_CRYPTO_PAYOUTS: z
        .enum(['true', 'false'])
        .default('false')
        .transform((data) => data === 'true'),

    ///////////////////////////
    /// Xata
    ///////////////////////////
    XATA_API_KEY: notEmptyStringSchema('XATA_API_KEY'),
    XATA_BRANCH: notEmptyStringSchema('XATA_BRANCH'),

    ///////////////////////////
    /// Alchemy
    ///////////////////////////
    ALCHEMY_API_KEY: notEmptyStringSchema('ALCHEMY_API_KEY'),
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

    REDIS_URL: z.string().optional().default('redis://localhost:6379'),

    ///////////////////////
    /// Blockradar
    ///////////////////////
    BASE_MASTER_WALLET_API_KEY: notEmptyStringSchema('BASE_MASTER_WALLET_API_KEY'),
    POLYGON_MASTER_WALLET_API_KEY: notEmptyStringSchema('POLYGON_MASTER_WALLET_API_KEY'),
    ETHEREUM_MASTER_WALLET_API_KEY: notEmptyStringSchema('ETHEREUM_MASTER_WALLET_API_KEY'),
    TRON_MASTER_WALLET_API_KEY: notEmptyStringSchema('TRON_MASTER_WALLET_API_KEY'),
    OPTIMISM_MASTER_WALLET_API_KEY: notEmptyStringSchema('OPTIMISM_MASTER_WALLET_API_KEY'),
    BSC_MASTER_WALLET_API_KEY: notEmptyStringSchema('BSC_MASTER_WALLET_API_KEY'),
    SOLANA_MASTER_WALLET_API_KEY: notEmptyStringSchema('SOLANA_MASTER_WALLET_API_KEY'),
    ASSET_CHAIN_MASTER_WALLET_API_KEY: notEmptyStringSchema('ASSET_CHAIN_MASTER_WALLET_API_KEY'),
    ARBITRUM_MASTER_WALLET_API_KEY: notEmptyStringSchema('ARBITRUM_MASTER_WALLET_API_KEY'),
    LISK_MASTER_WALLET_API_KEY: notEmptyStringSchema('LISK_MASTER_WALLET_API_KEY'),
    CELO_MASTER_WALLET_API_KEY: notEmptyStringSchema('CELO_MASTER_WALLET_API_KEY'),
    SMILE_ID_PARTNER_ID: notEmptyStringSchema('SMILE_ID_PARTNER_ID'),
    SMILE_ID_BASE_URL: notEmptyStringSchema('SMILE_ID_BASE_URL'),
    SMILE_ID_WEBHOOK_URL: notEmptyStringSchema('SMILE_ID_WEBHOOK_URL'),
    SMILE_ID_PROD_API_KEY: notEmptyStringSchema('SMILE_ID_PROD_API_KEY'),

    ///////////////////////
    /// SafeHaven
    ///////////////////////
    SAFEHAVEN_CLIENT_ID: notEmptyStringSchema('SAFEHAVEN_CLIENT_ID'),
    SAFEHAVEN_CLIENT_ASSERTION: notEmptyStringSchema('SAFEHAVEN_CLIENT_ASSERTION'),
    SAFEHAVEN_BASE_URL: notEmptyStringSchema('SAFEHAVEN_BASE_URL').and(z.string().url()),
    EXECUTE_SAFEHAVEN_TX_STATUS_UPDATE: z
        .enum(['true', 'false'])
        .default('false')
        .transform((data) => data === 'true'),
    EXECUTE_NGN_VAS_TX_STATUS_UPDATE: z
        .enum(['true', 'false'])
        .default('false')
        .transform((data) => data === 'true'),

    ///////////////////////
    /// BELLMFB
    ///////////////////////
    BELL_BASED_URL: notEmptyStringSchema('BELL_BASED_URL').and(z.string().url()),
    BELL_CONSUMER_KEY: notEmptyStringSchema('BELL_CONSUMER_KEY'),
    BELL_CONSUMER_SECRET: notEmptyStringSchema('BELL_CONSUMER_SECRET'),

    ///////////////////////
    /// HoneyCoin
    ///////////////////////
    HONEYCOIN_API_KEY: notEmptyStringSchema('HONEYCOIN_API_KEY'),
    HONEYCOIN_PUBLIC_KEY: notEmptyStringSchema('HONEYCOIN_PUBLIC_KEY'),
    HONEYCOIN_BASE_URL: notEmptyStringSchema('HONEYCOIN_BASE_URL').and(z.string().url()),
    HONEYCOIN_WEBHOOK_SECRET: notEmptyStringSchema('HONEYCOIN_WEBHOOK_SECRET'),



    ///////////////////////////
    /// p2p agent account balance
    ///////////////////////////
    P2P_AGENT_ACCOUNT_BALANCE_MASK_KEY: notEmptyStringSchema('P2P_AGENT_ACCOUNT_BALANCE_MASK_KEY'),
    P2P_AGENT_ACCOUNT_BALANCE_MASK_IV: notEmptyStringSchema('P2P_AGENT_ACCOUNT_BALANCE_MASK_IV'),

});

const env = envSchema.parse(process.env);

export { envSchema };
export default env;
