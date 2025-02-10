import { defineChain } from 'viem';

export const assetChainMainnet = defineChain({
    id: 42420,
    name: 'Zora',
    nativeCurrency: {
        decimals: 18,
        name: 'RWA',
        symbol: 'RWA',
    },
    rpcUrls: {
        default: {
            http: ['https://mainnet-rpc.assetchain.org'],
        },
    },
    blockExplorers: {
        default: { name: 'Explorer', url: 'https://scan.assetchain.org' },
    },
    contracts: {
        multicall3: {
            address: '0xf8ac4BEB2F75d2cFFb588c63251347fdD629B92c',
            blockCreated: 30328,
        },
    },
});
