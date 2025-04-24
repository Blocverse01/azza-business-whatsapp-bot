## 🧱 Adding a New Blockchain to Azza

To support a new blockchain on Azza, you'll need to configure platform-level resources and provider-specific details that enable full interaction with the chain.

These include:

- A unique chain identifier
- Explorer URLs for testnet and mainnet
- A node configuration (for EVM chains)
- Blockradar master wallet setup

---

### 🔧 Platform Configuration

#### 1. Define Chain Identifier

Set this in [`blockchains.ts`](../src/resources/web3/core/blockchains.ts). Add the chain name to either the `EVM_BLOCKCHAINS` or `NON_EVM_BLOCKCHAINS` array:

```ts
export const EVM_BLOCKCHAINS = [
  'Base',
  'Optimism',
  'Polygon',
  'Ethereum',
  'AssetChain',
  'Arbitrum', 
  'Bep20', // <- New chain
] as const;

export const NON_EVM_BLOCKCHAINS = ['Solana', 'Tron'] as const;
```

---

#### 2. Add Explorer URLs

Configure this in [`explorerUrls.ts`](../src/resources/web3/core/explorerUrls.ts) under the `EXPLORER_URLS` record:

```ts
const EXPLORER_URLS: {
  [key in AllSupportedBlockchains]: {
    testnet: string;
    mainnet: string;
  };
} = {
  Ethereum: {
    testnet: 'https://sepolia.etherscan.io',
    mainnet: 'https://etherscan.io',
  },
  Base: {
    testnet: 'https://sepolia.basescan.org',
    mainnet: 'https://basescan.org',
  }, 
    /////////////////
    // New values
    ////////////////
  Bep20: {
    testnet: 'https://testnet.bscscan.com',
    mainnet: 'https://bscscan.com',
  },
};
```

---

#### 3. Add Custom Node Config (EVM Only)

Because of legacy coupling, adding an EVM-based chain requires node configs.

**Entry Point:** [`evm.config.ts`](../src/resources/web3/evm/evm.config.ts)

##### ➤ Step 1: Extend `EvmNode` keys
```ts
export type EvmNode =
  | 'ankr-base-mainnet'
  | 'ankr-base-sepolia'
  | ...
  | 'default-bsc-mainnet'
  | 'default-bsc-testnet';
```

##### ➤ Step 2: Create Node Config Objects

Use `viem`'s default config for RPC URLs:

```ts
export const defaultBscTestnet: EvmNetworkConfig = {
  rpcUrl: bscTestnet.rpcUrls['default'].http[0],
  key: 'default-bsc-testnet',
  network: 'Bep20',
  viemChain: bscTestnet,
};

export const defaultBscMainnet: EvmNetworkConfig = {
  rpcUrl: bsc.rpcUrls['default'].http[0],
  key: 'default-bsc-mainnet',
  network: 'Bep20',
  viemChain: bsc,
};
```

##### ➤ Step 3: Register in Default Configs

Update the master `APP_DEFAULT_EVM_NETWORK_CONFIGS`:

```ts
const APP_DEFAULT_EVM_NETWORK_CONFIGS = {
  Base: { mainnet: ankrBaseMainnet, testnet: ankrBaseSepolia },
  ...
  Bep20: {
    mainnet: defaultBscMainnet,
    testnet: defaultBscTestnet,
  },
};
```

---

### 🤝 Provider Configuration

To fully enable blockchain interaction, you must configure Blockradar integration.

#### 1. Add Master Wallet Clients

**File:** [`master-wallet-clients.ts`](../src/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients.ts)

Add both testnet and mainnet entries. **Use `env` references** for sensitive keys.

```ts
const testnet__masterWalletApiConfig = {
  ...
  Bep20: {
    masterWalletId: '369ba83b-6545-4132-868c-2bbab7c88c52',
    apiKey: env.BSC_MASTER_WALLET_API_KEY,
  },
};

const mainnet__masterWalletApiConfig = {
  ...
  Bep20: {
    masterWalletId: '59369735-9b6a-4575-b5ea-054773047589',
    apiKey: env.BSC_MASTER_WALLET_API_KEY,
  },
};
```

> ✅ Make sure these wallet IDs exist in the Blockradar dashboard and the API keys are added to your env config.

---

## 💰 Adding New Assets

Once a blockchain is configured, you can add supported assets like USDC or USDT on it.

---

### 🔧 Platform Asset Config

**Entry Point:** [`tokens.ts`](../src/resources/web3/core/tokens.ts)

Create a config object for each asset:

```ts
export const usdcBep20Config = {
  tokenAddress:
    env.WEB3_ENVIRONMENT === 'testnet'
      ? TokenAddresses.USDC_BEP20_TESTNET
      : TokenAddresses.USDC_BEP20_MAINNET,
  tokenName: TokenNames.USDC,
  listItemId: AssetInteractiveButtonIds.USDC_BEP20,
  network: 'Bep20',
  supportedAssetActions: ALL_ASSET_ACTIONS,
  showOnAssetsMenu: true,
} satisfies AssetConfig;
```

---

### 🧱 Required Dependencies

To support a new asset, you need:

- ✅ Token address (mainnet & testnet)
- ✅ Token name
- ✅ Interactive button ID
- ✅ Associated blockchain network
- ✅ List of supported actions (BUY, SELL, etc.)

---

#### 1. Add Token Addresses

**Update:** `TokenAddresses` enum

```ts
export enum TokenAddresses {
  ...
  USDC_BEP20_MAINNET = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  USDC_BEP20_TESTNET = '0x64544969ed7EBf5f083679233325356EbE738930',

  USDT_BEP20_MAINNET = '0x55d398326f99059fF775485246999027B3197955',
  USDT_BEP20_TESTNET = '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
}
```

---

#### 2. Add Interactive Button IDs

**Update:** [`WhatsAppBotType.ts`](../src/app/WhatsAppBot/WhatsAppBotType.ts)

```ts
export enum AssetInteractiveButtonIds {
  ...
  USDC_BEP20 = 'usdc-bep20',
  USDT_BEP20 = 'usdt-bep20',
  BNB_BEP20 = 'bnb-bep20',
}
```

From the enum above, it is important to point out that asset IDs follow the following pattern:

```
<symbol-network>
```

Example: `USDT-BEP20`, `ETH-ETHEREUM`

#### 3. Specify supported actions

Depending on what actions the new asset supports, use the full `ALL_ASSET_ACTIONS` array or a custom subset:

**If the asset supports all actions:**
```ts
export const usdtBep20Config = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDT_BEP20_TESTNET
            : TokenAddresses.USDT_BEP20_MAINNET,
    tokenName: TokenNames.USDT,
    listItemId: AssetInteractiveButtonIds.USDT_BEP20,
    network: 'Bep20',
    supportedAssetActions: ALL_ASSET_ACTIONS,
    showOnAssetsMenu: true,
} satisfies AssetConfig;
```

**If the asset supports a subset of actions:**
```ts
export const solConfig = {
    tokenName: TokenNames.SOL,
    listItemId: AssetInteractiveButtonIds.SOL,
    tokenAddress: 'SOL',
    network: 'Solana' as const,
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: false,
    isNative: true,
} satisfies AssetConfig;
```

#### 4. Token Name and Network

- Use token names from the `TokenNames` enum (e.g., `TokenNames.USDC`)
- Use a value from the `AllSupportedBlockchain` type for the `network` field

---

### 2. Configure Blockradar Asset IDs

This step maps the asset to a Blockradar master wallet asset ID.

Navigate to:
```
src/app/AzzaWalletManager/providers/blockradar/resources/assets.ts
```

Update the appropriate environment’s record (`testnet__blockradarAssetIdMap` or `mainnet__blockradarAssetIdMap`) with a new key-value pair.

```ts
const testnet__blockradarAssetIdMap: Record<string, string> = {
    ...
    //////////////////
    // New assets
    /////////////////
    [AssetInteractiveButtonIds.USDT_BEP20]: '0ee7dab5-aa27-4a54-9513-455b10bdd73a',
    [AssetInteractiveButtonIds.BNB_BEP20]: '18b9aead-ff3c-44db-9b1b-9de9e7b679cd',
};

const mainnet__blockradarAssetIdMap: Record<string, string> = {
    ...
    //////////////////
    // New assets
    /////////////////
    [AssetInteractiveButtonIds.USDC_BEP20]: 'f2e5ad81-a3a0-4a70-a047-5a6c5abe3566',
    [AssetInteractiveButtonIds.USDT_BEP20]: '7c56a91a-d98c-4a22-afe8-282bbe30539e',
    [AssetInteractiveButtonIds.BNB_BEP20]: '12e29e8b-81d1-4961-b48e-b7e4c98351ca',
};
```

🧠 These asset IDs can be found on the Blockradar master wallet overview page. Note that testnet and mainnet use different values.

---

### 3. Enable the Asset in the Bot

To activate the asset on the WhatsApp bot interface, add the config object to the `ENABLED_ASSETS` array in:

```
src/config/whatsAppBot.ts
```

```ts
export const ENABLED_ASSETS = [
    usdcEthConfig,
    usdtEthConfig,
    usdcOptimismConfig,
    usdtOptimismConfig,
    usdcPolygonConfig,
    usdtPolygonConfig,
    usdcBaseConfig,

    ///////////////////
    // New assets
    //////////////////
    usdtBep20Config,
    usdcBep20Config,
];
```