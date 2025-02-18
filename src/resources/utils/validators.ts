import { publicTronWebClient } from '@/app/ExtendedWallet/tron/tronNetworkClient';
import {
    AllSupportedBlockchains,
    isEvmCompatibleBlockchain,
} from '@/resources/web3/core/blockchains';
import { PublicKey } from '@solana/web3.js';
import { isAddress } from 'viem';

export const validateWalletAddress = (
    address: string,
    network: AllSupportedBlockchains
): boolean => {
    const networkFamily = getNetworkFamily(network);

    if (networkFamily === 'evm') {
        return isAddress(address);
    }

    if (networkFamily === 'tron') {
        return publicTronWebClient.isAddress(address);
    }

    if (networkFamily === 'solana') {
        try {
            new PublicKey(address);
            return true;
        } catch (error) {
            return false;
        }
    }

    throw new Error('Unsupported network family');
};

export const getNetworkFamily = (network: AllSupportedBlockchains): 'evm' | 'solana' | 'tron' => {
    if (isEvmCompatibleBlockchain(network)) {
        return 'evm';
    }

    switch (network) {
        case 'Tron':
            return 'tron';
        case 'Solana':
            return 'solana';
        default:
            throw new Error('Unsupported network');
    }
};
