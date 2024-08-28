import { isAddress } from 'viem';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { publicTronWebClient } from '@/app/ExtendedWallet/tron/tronNetworkClient';

export const validateWalletAddress = (
    address: string,
    network: SupportedChain | ExtendedWalletSupportedNetworks
): boolean => {
    const networkFamily = getNetworkFamily(network);

    if (networkFamily === 'evm') {
        return isAddress(address);
    }

    if (networkFamily === 'tron') {
        return publicTronWebClient.isAddress(address);
    }

    throw new Error('Unsupported network family');
};

export const getNetworkFamily = (
    network: SupportedChain | ExtendedWalletSupportedNetworks
): 'evm' | 'solana' | 'tron' => {
    switch (network) {
        case 'Base':
        case 'Ethereum':
        case 'Optimism':
        case 'Polygon':
        case 'Bep20':
            return 'evm';
        case 'Tron':
            return 'tron';
        case 'Solana':
            return 'solana';
        default:
            throw new Error('Unsupported network');
    }
};
