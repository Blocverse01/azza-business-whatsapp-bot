## Adding new blockchains
Adding a new blockchain on Azza starts from configuring resources needed by the platform to perform full operations on the chain.
Such resources include:
- An Identifier for the chain (e.g  Solana, Base, e.t.c).
- Explorer URLs for a testnet and the mainnet network for the chain.
- A custom node config (applies to only EVMs)
### Platform config
#### Configuring Chain Identifier/Name

This config is set in the `src/resources/web3/core/blockchains.ts` file. 
A new chain is added by adding a new value to either the `EVM_BLOCKCHAINS` or `NON_EVM_BLOCKCHAINS` array
```ts
export const EVM_BLOCKCHAINS = [
    'Base',
    'Optimism',
    'Polygon',
    'Ethereum',
    'Bep20',
    'AssetChain',
    'Arbitrum',
] as const;
export const NON_EVM_BLOCKCHAINS = ['Solana', 'Tron'] as const;
```

---

#### Configuring Explorer URLs

### Provider config

## Adding new assets
### Platform config
### Provider config

