import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import {
    extendedWalletSupportedNetworks,
    ExtendedWalletSupportedNetworks,
} from '@/app/ExtendedWallet/extendedWalletSchema';

export const isExtendedNetwork = (
    network: SupportedChain | ExtendedWalletSupportedNetworks
): network is ExtendedWalletSupportedNetworks => {
    const validation = extendedWalletSupportedNetworks.safeParse(network);
    return validation.success;
};
