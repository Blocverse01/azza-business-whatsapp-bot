import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';

type NetworkTransactionFeeConfig = {
    minimumFee: number;
    maximumFee: number;
    feeThreshold: number;
    feePerThreshold: number;
};

/**
 * @description Fee configuration for stable token transfer on different networks. Stable token tokens are tokens like USDC, USDT, etc.
 * */
export const networkStableTokenTransferFeeConfig: Record<
    SupportedChain | ExtendedWalletSupportedNetworks,
    NetworkTransactionFeeConfig
> = {
    Base: {
        minimumFee: 0.01, // 0.01 USDT | USDC
        maximumFee: 0.5,
        feeThreshold: 10,
        feePerThreshold: 0.001, // 0.001 for every 10 USDT | USDC
    },
    Lisk: {
        minimumFee: 0.01, // 0.01 USDT | USDC
        maximumFee: 0.5,
        feeThreshold: 10,
        feePerThreshold: 0.001, // 0.001 for every 10 USDT | USDC
    },
    Polygon: {
        minimumFee: 0.1, // 0.1 USDT | USDC
        maximumFee: 0.5,
        feeThreshold: 10,
        feePerThreshold: 0.001, // 0.001 for every 10 USDT | USDC
    },
    Optimism: {
        minimumFee: 0.2, // 0.2 USDT | USDC
        maximumFee: 0.5,
        feeThreshold: 10,
        feePerThreshold: 0.001, // 0.001 for every 10 USDT | USDC
    },
    Ethereum: {
        minimumFee: 20, // 20 USDT | USDC
        maximumFee: 50,
        feeThreshold: 10,
        feePerThreshold: 0.2, // 0.2 for every 10 USDT | USDC
    },
    Bep20: {
        minimumFee: 0.1, // 0.1 USDT | USDC
        maximumFee: 0.5,
        feeThreshold: 10,
        feePerThreshold: 0.001, // 0.001 for every 10 USDT | USDC
    },
    // Solana and Tron network fees are paid in the native token and directly by the user.
    Solana: {
        minimumFee: 0, // 0 USDT | USDC
        maximumFee: 0,
        feeThreshold: 0,
        feePerThreshold: 0, // 0 for every 10 USDT | USDC
    },
    Tron: {
        minimumFee: 0, // 0 USDT | USDC
        maximumFee: 0,
        feeThreshold: 0,
        feePerThreshold: 0, // 0 for every 10 USDT | USDC
    },
};

export function calculateStableTokenTransferTransactionFee(
    chain: SupportedChain | ExtendedWalletSupportedNetworks,
    amount: number
): number {
    const config = networkStableTokenTransferFeeConfig[chain];
    const { minimumFee, maximumFee, feeThreshold, feePerThreshold } = config;

    const numberOfThresholds = Math.floor(amount / feeThreshold);
    const calculatedFee = numberOfThresholds * feePerThreshold;

    let appliedFee = calculatedFee;

    if (calculatedFee < minimumFee) {
        appliedFee = minimumFee;
    } else if (calculatedFee > maximumFee) {
        appliedFee = maximumFee;
    }

    return appliedFee;
}
