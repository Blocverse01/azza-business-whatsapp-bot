import {
    getDefaultTronNodeConfig,
    NodeConfig,
    PrivateNodeConfig,
    TronWebClient,
} from '@/app/ExtendedWallet/tron/config';

export const createTronWebClient = (nodeConfig: NodeConfig) => {
    return new TronWebClient({
        fullHost: nodeConfig.fullHost,
        headers: nodeConfig.headers,
        privateKey: nodeConfig.privateKey,
    });
};

export const publicTronWebClient = createTronWebClient(getDefaultTronNodeConfig());

export const createPrivateTronWebClient = (nodeConfig: PrivateNodeConfig) => {
    if (!nodeConfig.privateKey.trim()) {
        throw new Error('Invalid private node configuration');
    }
    return createTronWebClient(nodeConfig);
};
