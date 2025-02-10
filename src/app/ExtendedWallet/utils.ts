import {
    activeExtendedWalletSupportedNetworks,
    ExtendedWalletSupportedNetworks,
} from '@/app/ExtendedWallet/extendedWalletSchema';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';

export const isExtendedNetwork = (
    network: AllSupportedBlockchains
): network is ExtendedWalletSupportedNetworks => {
    const validation = activeExtendedWalletSupportedNetworks.safeParse(network);
    return validation.success;
};
