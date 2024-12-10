import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import {
    activeExtendedWalletSupportedNetworks,
    ExtendedWalletSupportedNetworks,
} from '@/app/ExtendedWallet/extendedWalletSchema';

export const isExtendedNetwork = (
    network: SupportedChain | ExtendedWalletSupportedNetworks
): network is ExtendedWalletSupportedNetworks => {
    const validation = activeExtendedWalletSupportedNetworks.safeParse(network);
    return validation.success;
};
