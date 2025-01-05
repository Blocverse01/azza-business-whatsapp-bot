import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { isExtendedNetwork } from '@/app/ExtendedWallet/utils';
import { UserAssetInfo } from '@/app/User/userSchema';
import { calculateStableTokenTransferTransactionFee } from '@/app/WalletAssetManagement/config';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import { TWO, ZERO } from '@/constants/numbers';
import { fixNumber } from '@/resources/utils/currency';
import { validateWalletAddress } from '@/resources/utils/validators';
import { getAddress, parseEther, toHex } from 'viem';

class WalletAssetManagementService {
    public static readonly SHOULD_CHARGE_TRANSACTION_FEE = false;

    public static async transferUserAssetToWallet(
        asset: UserAssetInfo,
        walletAddress: string,
        amount: string
    ) {
        const isNativeTokenTransfer = !validateWalletAddress(
            asset.tokenAddress,
            asset.assetNetwork
        );

        const transactionResponse = isExtendedNetwork(asset.assetNetwork)
            ? isNativeTokenTransfer
                ? await asset.extendedWallet!.transferNativeToken(Number(amount), walletAddress)
                : await asset.extendedWallet!.transferToken(
                      asset.tokenAddress,
                      Number(amount),
                      walletAddress
                  )
            : isNativeTokenTransfer
              ? await WalletKitService.signAndSendTransaction({
                    network: asset.assetNetwork,
                    signer_wallet_address: getAddress(asset.walletAddress),
                    developer_secret: WalletKitService.DEVELOPER_SECRET,
                    unsigned_transaction: {
                        to: getAddress(walletAddress),
                        value: toHex(parseEther(amount)),
                    },
                })
              : await WalletKitService.transferToken({
                    amount: amount,
                    network: asset.assetNetwork,
                    developer_secret: WalletKitService.DEVELOPER_SECRET,
                    token: asset.tokenAddress,
                    from: asset.walletAddress,
                    recipient: walletAddress,
                });

        return 'transactionHash' in transactionResponse
            ? {
                  transactionId: transactionResponse.transactionHash,
                  status: transactionResponse.status,
              }
            : {
                  transactionId: transactionResponse.transaction_id,
                  status: transactionResponse.status,
              };
    }

    public static calculateStableTokenTransferTransactionFee(
        amount: string,
        network: SupportedChain | ExtendedWalletSupportedNetworks
    ) {
        if (!this.SHOULD_CHARGE_TRANSACTION_FEE) return ZERO;

        return fixNumber(calculateStableTokenTransferTransactionFee(network, Number(amount)), TWO);
    }
}

export default WalletAssetManagementService;
