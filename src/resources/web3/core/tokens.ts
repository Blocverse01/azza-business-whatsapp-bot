import { AssetInteractiveButtonIds, ExploreAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import env from '@/constants/env';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';

// For testnet tokens, it's best to deploy a mock token on the intended network to ensure available supply.
// Especially when there's no official faucet for such token.

export enum TokenAddresses {
    /**
     * Polygon Asset Addresses
     */
    // USDC
    USDC_MATIC_MAINNET = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    USDC_MATIC_TESTNET = '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582',

    // USDT
    USDT_MATIC_MAINNET = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    USDT_MATIC_TESTNET = '0x1616d425Cd540B256475cBfb604586C8598eC0FB',

    /**
     * Base Asset Addresses
     */
    // USDC
    USDC_BASE_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDC_BASE_TESTNET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e',

    /**
     * Ethereum Asset Addresses
     */
    // USDC
    USDC_ETH_MAINNET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDC_ETH_SEPOLIA_TESTNET = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',

    // USDT
    USDT_ETH_MAINNET = '0xdac17f958d2ee523a2206206994597c13d831ec7',
    USDT_ETH_SEPOLIA_TESTNET = '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',

    /**
     * Optimism Asset Addresses
     */
    // USDC
    USDC_OPTIMISM_MAINNET = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    USDC_OPTIMISM_SEPOLIA_TESTNET = '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',

    // USDT
    USDT_OPTIMISM_MAINNET = '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    USDT_OPTIMISM_SEPOLIA_TESTNET = '0xf884B63217D3427677c7b045370Bb269FabF1FA7',

    // OP
    OP_OPTIMISM_MAINNET = '0x4200000000000000000000000000000000000042',
    OP_OPTIMISM_SEPOLIA_TESTNET = '0x62c021e584702C40D0c14923ba6934791a8DaaD3',

    /**
     * Tron Asset Addresses
     */
    // USDT
    USDT_TRON_MAINNET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    USDT_TRON_TESTNET = 'TWy8FMyiDX3UAmU2RMpLTUEUWpjc84M3RF',

    /**
     * Solana Asset Addresses
     */
    // USDC
    USDC_SOLANA_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDC_SOLANA_TESTNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',

    // USDT
    USDT_SOLANA_MAINNET = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    USDT_SOLANA_TESTNET = 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUUy1PVCMB4DYPzVaS',

    /**
     * BEP20 Asset Addresses
     */
    // USDT
    USDC_BEP20_MAINNET = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    USDC_BEP20_TESTNET = '0x64544969ed7EBf5f083679233325356EbE738930',

    // USDT
    USDT_BEP20_MAINNET = '0x55d398326f99059fF775485246999027B3197955',
    USDT_BEP20_TESTNET = '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',

    /**
     * Asset Chain Asset Addresses
     */
    // USDC
    USDC_ASSET_CHAIN_MAINNET = '0x2B7C1342Cc64add10B2a79C8f9767d2667DE64B2',
    USDC_ASSET_CHAIN_TESTNET = '0x39C6b75fAeAb6B54541BE34860AE6250263377e9',

    // USDT
    USDT_ASSET_CHAIN_MAINNET = '0x26E490d30e73c36800788DC6d6315946C4BbEa24',
    USDT_ASSET_CHAIN_TESTNET = '0x04f868C5b3F0A100a207c7e9312946cC2c48a7a3',
}

export enum TokenNames {
    USDT = 'USDT',
    USDC = 'USDC',
    POL = 'POL',
    ETH = 'ETH',
    SOL = 'SOL',
    OP = 'OP',
    TRX = 'TRX',
}

export type AssetConfig = {
    tokenAddress: string;
    tokenName: TokenNames | string;
    listItemId: AssetInteractiveButtonIds;
    network: AllSupportedBlockchains;
    supportedAssetActions: ExploreAssetActions[];
    showOnAssetsMenu?: boolean;
    isNative?: boolean;
};

const ALL_ASSET_ACTIONS: ExploreAssetActions[] = Object.values(ExploreAssetActions);

// Asset Configurations
// Polygon Assets
/// ============== USDC ==============
export const usdcPolygonConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDC_MATIC_TESTNET
            : TokenAddresses.USDC_MATIC_MAINNET,
    tokenName: TokenNames.USDC,
    listItemId: AssetInteractiveButtonIds.USDC_POLYGON,
    network: 'Polygon' as const,
    supportedAssetActions: ALL_ASSET_ACTIONS,
    showOnAssetsMenu: false,
} satisfies AssetConfig;
/// ============== USDT ==============
export const usdtPolygonConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDT_MATIC_TESTNET
            : TokenAddresses.USDT_MATIC_MAINNET,
    tokenName: TokenNames.USDT,
    listItemId: AssetInteractiveButtonIds.USDT_POLYGON,
    network: 'Polygon' as const,
    supportedAssetActions: ALL_ASSET_ACTIONS,
    showOnAssetsMenu: false,
} satisfies AssetConfig;
/// ============== MATIC ==============
export const polConfig = {
    tokenName: TokenNames.POL,
    listItemId: AssetInteractiveButtonIds.POL_POLYGON,
    tokenAddress: 'POL',
    network: 'Polygon' as const,
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: false,
    isNative: true,
} satisfies AssetConfig;

// Base Assets
/// ============== USDC ==============
export const usdcBaseConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDC_BASE_TESTNET
            : TokenAddresses.USDC_BASE_MAINNET,
    tokenName: TokenNames.USDC,
    listItemId: AssetInteractiveButtonIds.USDC_BASE,
    network: 'Base' as const,
    supportedAssetActions: ALL_ASSET_ACTIONS,
    showOnAssetsMenu: true,
} satisfies AssetConfig;
/// ============== ETH ==============
export const ethBaseConfig = {
    tokenName: TokenNames.ETH,
    listItemId: AssetInteractiveButtonIds.ETH_BASE,
    tokenAddress: 'ETH',
    network: 'Base' as const,
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: true,
    isNative: true,
} satisfies AssetConfig;

// Ethereum Assets
/// ============== USDC ==============
export const usdcEthConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDC_ETH_SEPOLIA_TESTNET
            : TokenAddresses.USDC_ETH_MAINNET,
    tokenName: TokenNames.USDC,
    listItemId: AssetInteractiveButtonIds.USDC_ETH,
    network: 'Ethereum' as const,
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
        ExploreAssetActions.SELL_ASSET,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: true,
} satisfies AssetConfig;
/// ============== USDT ==============
export const usdtEthConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDT_ETH_SEPOLIA_TESTNET
            : TokenAddresses.USDT_ETH_MAINNET,
    tokenName: TokenNames.USDT,
    listItemId: AssetInteractiveButtonIds.USDT_ETH,
    network: 'Ethereum' as const,
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
        ExploreAssetActions.SELL_ASSET,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: true,
} satisfies AssetConfig;
/// ============== ETH ==============
export const ethEthereumConfig = {
    tokenName: TokenNames.ETH,
    listItemId: AssetInteractiveButtonIds.ETH_ETHEREUM,
    tokenAddress: 'ETH',
    network: 'Ethereum' as const,
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: false,
    isNative: true,
} satisfies AssetConfig;

/////////////////////
// Optimism Assets
/////////////////////
/// ============ USDC ==============
export const usdcOptimismConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDC_OPTIMISM_SEPOLIA_TESTNET
            : TokenAddresses.USDC_OPTIMISM_MAINNET,
    tokenName: TokenNames.USDC,
    listItemId: AssetInteractiveButtonIds.USDC_OPTIMISM,
    network: 'Optimism' as const,
    supportedAssetActions: ALL_ASSET_ACTIONS,
    showOnAssetsMenu: false,
} satisfies AssetConfig;
/// ============== USDT ==============
export const usdtOptimismConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDT_OPTIMISM_SEPOLIA_TESTNET
            : TokenAddresses.USDT_OPTIMISM_MAINNET,
    tokenName: TokenNames.USDT,
    listItemId: AssetInteractiveButtonIds.USDT_OPTIMISM,
    network: 'Optimism' as const,
    supportedAssetActions: ALL_ASSET_ACTIONS,
    showOnAssetsMenu: false,
} satisfies AssetConfig;
/// ============== ETH ==============
export const ethOptimismConfig = {
    tokenName: TokenNames.ETH,
    listItemId: AssetInteractiveButtonIds.ETH_OPTIMISM,
    tokenAddress: 'ETH',
    network: 'Optimism',
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: false,
    isNative: true,
} satisfies AssetConfig;
/// ============== OP ==============
export const opOptimismConfig = {
    tokenName: TokenNames.OP,
    listItemId: AssetInteractiveButtonIds.OP_OPTIMISM,
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.OP_OPTIMISM_SEPOLIA_TESTNET
            : TokenAddresses.OP_OPTIMISM_MAINNET,
    network: 'Optimism',
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: false,
} satisfies AssetConfig;

// Tron Assets
/// ============== USDT ==============
export const usdtTronConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDT_TRON_TESTNET
            : TokenAddresses.USDT_TRON_MAINNET,
    tokenName: TokenNames.USDT,
    listItemId: AssetInteractiveButtonIds.USDT_TRON,
    network: 'Tron' as const,
    supportedAssetActions: ALL_ASSET_ACTIONS,
    showOnAssetsMenu: true,
} satisfies AssetConfig;
/// ============== TRX ==============
export const trxTronConfig = {
    tokenAddress: 'TRX',
    tokenName: TokenNames.TRX,
    listItemId: AssetInteractiveButtonIds.TRX,
    network: 'Tron' as const,
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: true,
    isNative: true,
} satisfies AssetConfig;

// Solana Assets
/// ============== SOL ==============
export const solConfig = {
    tokenName: TokenNames.SOL,
    listItemId: AssetInteractiveButtonIds.SOL,
    tokenAddress: 'SOL',
    network: 'Solana' as const,
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: true,
    isNative: true,
} satisfies AssetConfig;
/// ============== USDC ==============
export const usdcSolanaConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDC_SOLANA_TESTNET
            : TokenAddresses.USDC_SOLANA_MAINNET,
    tokenName: TokenNames.USDC,
    listItemId: AssetInteractiveButtonIds.USDC_SOLANA,
    network: 'Solana' as const,
    supportedAssetActions: ALL_ASSET_ACTIONS,
    showOnAssetsMenu: true,
} satisfies AssetConfig;
/// ============== USDT ==============
export const usdtSolanaConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDT_SOLANA_TESTNET
            : TokenAddresses.USDT_SOLANA_MAINNET,
    tokenName: TokenNames.USDT,
    listItemId: AssetInteractiveButtonIds.USDT_SOLANA,
    network: 'Solana' as const,
    supportedAssetActions: ALL_ASSET_ACTIONS,
    showOnAssetsMenu: true,
} satisfies AssetConfig;

// BEP20 Assets
/// ============== USDC ==============
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
/// ============== USDT ==============
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

// Asset Chain Assets
/// ============== USDC ==============
export const usdcAssetChainConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDC_ASSET_CHAIN_TESTNET
            : TokenAddresses.USDC_ASSET_CHAIN_MAINNET,
    tokenName: TokenNames.USDC,
    listItemId: AssetInteractiveButtonIds.USDC_ASSET_CHAIN,
    network: 'AssetChain',
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
        ExploreAssetActions.SELL_ASSET,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: false,
} satisfies AssetConfig;
/// ============== USDT ==============
export const usdtAssetChainConfig = {
    tokenAddress:
        env.WEB3_ENVIRONMENT === 'testnet'
            ? TokenAddresses.USDT_ASSET_CHAIN_TESTNET
            : TokenAddresses.USDT_ASSET_CHAIN_MAINNET,
    tokenName: TokenNames.USDT,
    listItemId: AssetInteractiveButtonIds.USDT_ASSET_CHAIN,
    network: 'AssetChain',
    supportedAssetActions: [
        ExploreAssetActions.WITHDRAW_ASSET,
        ExploreAssetActions.DEPOSIT,
        ExploreAssetActions.SELL_ASSET,
    ] as ExploreAssetActions[],
    showOnAssetsMenu: false,
} satisfies AssetConfig;
