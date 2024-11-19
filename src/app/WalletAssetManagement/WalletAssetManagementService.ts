import { UserAssetInfo } from '@/app/User/userSchema';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import env from '@/constants/env';
import { decimalToString, fixNumber } from '@/resources/utils/currency';
import { TWO, ZERO } from '@/constants/numbers';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { calculateStableTokenTransferTransactionFee } from '@/app/WalletAssetManagement/config';
import { validateWalletAddress } from '@/resources/utils/validators';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { isExtendedNetwork } from '@/app/ExtendedWallet/utils';

class WalletAssetManagementService {
    public static readonly SHOULD_CHARGE_TRANSACTION_FEE = false;

    public static async transferUserAssetToWallet(
        asset: UserAssetInfo,
        walletAddress: string,
        amount: string
    ) {
        if (!validateWalletAddress(asset.tokenAddress, asset.assetNetwork)) {
            throw new Error('Only Tokens are supported for transfer at the moment');
        }

        if (this.SHOULD_CHARGE_TRANSACTION_FEE) {
            const transactionFee = this.calculateStableTokenTransferTransactionFee(
                amount,
                asset.assetNetwork
            );

            if (isExtendedNetwork(asset.assetNetwork)) {
                if (transactionFee > ZERO && asset.extendedWallet) {
                    // Note: This should only be used for EVM chains, which means non-EVM chains are expected to have a ZERO transaction fee charged by the bot.
                    // Because transaction fees for non-EVm chains are paid by the user and determined by the network
                    await asset.extendedWallet.transferToken(
                        asset.tokenAddress,
                        transactionFee,
                        env.TRANSACTION_FEE_RECIPIENT
                    );
                }
            } else {
                await WalletKitService.transferToken({
                    amount: decimalToString(transactionFee),
                    network: asset.assetNetwork,
                    developer_secret: WalletKitService.DEVELOPER_SECRET,
                    token: asset.tokenAddress,
                    from: asset.walletAddress,
                    recipient: env.TRANSACTION_FEE_RECIPIENT, // An EVM address to receive the transaction fee. EVM for now because we are only supporting EVM chains ATM
                });
            }
        }

        const transactionResponse = isExtendedNetwork(asset.assetNetwork)
            ? await asset.extendedWallet!.transferToken(
                  asset.tokenAddress,
                  Number(amount),
                  walletAddress
              )
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
