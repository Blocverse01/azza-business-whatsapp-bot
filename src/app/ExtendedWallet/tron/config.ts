import TronWeb from 'tronweb';
import env from '@/constants/env';

export type TronNode = 'ankr-mainnet' | 'tron-grid-mainnet' | 'tron-grid-shasta';

export const TronWebClient = TronWeb.TronWeb;
// Export other types and functions

export type NodeConfig = {
    fullHost: string;
    key: TronNode;
    headers?: Record<string, string>;
    privateKey?: string;
};

export type PrivateNodeConfig = NodeConfig & {
    privateKey: string;
};

//========= Node Configuration =========
/**
 * Ankr node is a public node provided by Ankr
 * https://www.ankr.com/
 */
export const AnkrMainnetNode: NodeConfig = {
    fullHost: 'https://rpc.ankr.com/http/tron',
    key: 'ankr-mainnet',
};

/**
 * TronGrid API key is required for TronGrid nodes
 * https://www.trongrid.io/
 * https://developers.tron.network/docs/trongrid
 */
export const TronGridMainnetNode: NodeConfig = {
    fullHost: 'https://api.trongrid.io',
    headers: { 'TRON-PRO-API-KEY': env.TRON_GRID_API_KEY },
    key: 'tron-grid-mainnet',
};
export const TronGridShastaNode: NodeConfig = {
    fullHost: 'https://api.shasta.trongrid.io',
    headers: { 'TRON-PRO-API-KEY': env.TRON_GRID_API_KEY },
    key: 'tron-grid-shasta',
};

type TronNodes = Map<TronNode, NodeConfig>;

/**
 * Map of Tron nodes
 * @key TronNode
 * @value NodeConfig
 * @example TronNodes.get('ankr-mainnet')
 */
export const TronNodes: TronNodes = new Map([
    ['ankr-mainnet', AnkrMainnetNode],
    ['tron-grid-mainnet', TronGridMainnetNode],
    ['tron-grid-shasta', TronGridShastaNode],
]);

export const createPrivateNodeConfig = (
    nodeName: TronNode,
    privateKey: string
): PrivateNodeConfig => {
    const nodeConfig = getTronNodeConfig(nodeName);

    return {
        ...nodeConfig,
        privateKey,
    };
};

export const getTronNodeConfig = (nodeName: TronNode): NodeConfig => {
    const nodeConfig = TronNodes.get(nodeName);

    if (nodeConfig === undefined) {
        throw new Error('Invalid Tron node configuration');
    }

    return nodeConfig;
};

export const getDefaultTronNode = (): TronNode => {
    return env.WEB3_ENVIRONMENT === 'testnet' ? 'tron-grid-shasta' : 'tron-grid-mainnet';
};

export const getDefaultTronNodeConfig = (): NodeConfig => {
    const defaultTronNode = getDefaultTronNode();

    return getTronNodeConfig(defaultTronNode);
};
