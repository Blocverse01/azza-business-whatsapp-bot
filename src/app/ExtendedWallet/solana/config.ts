import env from '@/constants/env';
import { Connection, PublicKey } from '@solana/web3.js';

export type SolanaNode =
    | 'ankr-devnet'
    | 'solana-devnet'
    | 'solana-mainnet-beta'
    | 'helius-mainnet'
    | 'helius-devnet'
    | 'quicknode-mainnet'
    | 'quicknode-devnet';

export type SolanaNodeConfig = {
    rpcUrl: string;
    key: SolanaNode;
    commitment?: 'processed' | 'confirmed' | 'finalized';
};

export const CONFIRMED_COMMITMENT: 'confirmed' = 'confirmed';

//========= Node Configuration =========
/**
 * Ankr node is a public node provided by Ankr
 * https://www.ankr.com/rpc/solana/
 */
const AnkrDevnetNode: SolanaNodeConfig = {
    rpcUrl: `https://rpc.ankr.com/solana_devnet/${env.ANKR_PROJECT_KEY}`,
    key: 'ankr-devnet',
    commitment: CONFIRMED_COMMITMENT,
};

/**
 * Solana Devnet node
 */
const SolanaDevnetNode: SolanaNodeConfig = {
    rpcUrl: 'https://api.devnet.solana.com',
    key: 'solana-devnet',
    commitment: CONFIRMED_COMMITMENT,
};

/**
 * Solana Mainnet Beta node
 */
const SolanaMainnetBetaNode: SolanaNodeConfig = {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    key: 'solana-mainnet-beta',
    commitment: CONFIRMED_COMMITMENT,
};

/**
 * Helius Mainnet node
 * https://helius.dev/
 */
const HeliusMainnetNode: SolanaNodeConfig = {
    rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`,
    key: 'helius-mainnet',
    commitment: CONFIRMED_COMMITMENT,
};

/**
 * Helius Devnet node
 * https://helius.dev/
 */
const HeliusDevnetNode: SolanaNodeConfig = {
    rpcUrl: `https://devnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`,
    key: 'helius-devnet',
    commitment: CONFIRMED_COMMITMENT,
};

/**
 * Quicknode Mainnet node
 * https://www.quicknode.com/
 */
const QuicknodeMainnetNode: SolanaNodeConfig = {
    rpcUrl: `https://ultra-long-patron.solana-mainnet.quiknode.pro/${env.QUICKNODE_API_KEY}`,
    key: 'quicknode-mainnet',
    commitment: CONFIRMED_COMMITMENT,
};
/**
 * Quicknode Devnet node
 */
const QuicknodeDevnetNode: SolanaNodeConfig = {
    rpcUrl: `https://ultra-long-patron.solana-devnet.quiknode.pro/${env.QUICKNODE_API_KEY}`,
    key: 'quicknode-devnet',
    commitment: CONFIRMED_COMMITMENT,
};

type SolanaNodes = Map<SolanaNode, SolanaNodeConfig>;

/**
 * Map of Solana nodes
 * @key SolanaNode
 * @value SolanaNodeConfig
 * @example SolanaNodes.get('solana-devnet')
 */
export const SolanaNodes: SolanaNodes = new Map([
    ['ankr-devnet', AnkrDevnetNode],
    ['solana-devnet', SolanaDevnetNode],
    ['solana-mainnet-beta', SolanaMainnetBetaNode],
    ['helius-mainnet', HeliusMainnetNode],
    ['helius-devnet', HeliusDevnetNode],
    ['quicknode-mainnet', QuicknodeMainnetNode],
    ['quicknode-devnet', QuicknodeDevnetNode],
]);

export const getSolanaNodeConfigOrThrow = (nodeName: SolanaNode): SolanaNodeConfig => {
    if (!SolanaNodes.has(nodeName)) {
        throw new Error(`Node configuration not found for ${nodeName}`);
    }
    return SolanaNodes.get(nodeName)!;
};

/**
 * These are the default node keys for each environment
 * @example DEFAULT_NODE_KEYS[env.WEB3_ENVIRONMENT]
 */
const DEFAULT_NODE_KEYS: {
    [key in typeof env.WEB3_ENVIRONMENT]: SolanaNode;
} = {
    mainnet: 'helius-mainnet', // Helius Mainnet node
    testnet: 'ankr-devnet', // Public Solana Devnet node
};

// Network Client Instances
type SolanaNetworkClients = Map<SolanaNode, Connection>;

let solanaNetworkClients: SolanaNetworkClients | undefined;

export const storeSolanaNetworkClient = (nodeConfig: SolanaNodeConfig, connection: Connection) => {
    if (!solanaNetworkClients) {
        solanaNetworkClients = new Map<SolanaNode, Connection>();
    }

    solanaNetworkClients.set(nodeConfig.key, connection);
};

export const createSolanaNetworkClient = (nodeConfig: SolanaNodeConfig) => {
    const existingConnection = solanaNetworkClients?.get(nodeConfig.key);

    if (existingConnection) {
        return existingConnection;
    }

    const connection = new Connection(nodeConfig.rpcUrl, nodeConfig.commitment);

    storeSolanaNetworkClient(nodeConfig, connection);
    return connection;
};

export const getSolanaNetworkClient = (nodeName: SolanaNode) => {
    const nodeConfig = getSolanaNodeConfigOrThrow(nodeName);
    return createSolanaNetworkClient(nodeConfig);
};

export const getDefaultSolanaNode = () => DEFAULT_NODE_KEYS[env.WEB3_ENVIRONMENT];

export const defaultSolanaNetworkClient = getSolanaNetworkClient(getDefaultSolanaNode());

export const SPL_TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_PROGRAM_ID = new PublicKey(SPL_TOKEN_PROGRAM_ADDRESS);

export const WALLET_DERIVATION_PATH = "m/44'/501'/0'/0'";
