import { UserAssetItem } from '@/app/User/userSchema';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import env from '@/constants/env';
import { decimalToString, fixNumber } from '@/Resources/utils/currency';
import { TWO, ZERO } from '@/constants/numbers';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { isAddress } from 'viem';
import { calculateStableTokenTransferTransactionFee } from '@/app/WalletAssetManagement/config';

class WalletAssetManagementService {
    public static readonly SHOULD_CHARGE_TRANSACTION_FEE = false;

    public static async transferUserAssetToWallet(
        asset: UserAssetItem,
        walletAddress: string,
        amount: string
    ) {
        if (!isAddress(asset.tokenAddress)) {
            throw new Error('Only Tokens are supported for transfer at the moment');
        }

        if (this.SHOULD_CHARGE_TRANSACTION_FEE) {
            const transactionFee = this.calculateStableTokenTransferTransactionFee(
                amount,
                asset.network
            );

            await WalletKitService.transferToken({
                amount: decimalToString(transactionFee),
                network: asset.network,
                developer_secret: WalletKitService.DEVELOPER_SECRET,
                token: asset.tokenAddress,
                from: asset.walletAddress,
                recipient: env.TRANSACTION_FEE_RECIPIENT, // An EVM address to receive the transaction fee. EVM for now because we are only supporting EVM chains ATM
            });
        }

        return await WalletKitService.transferToken({
            amount: amount,
            network: asset.network,
            developer_secret: WalletKitService.DEVELOPER_SECRET,
            token: asset.tokenAddress,
            from: asset.walletAddress,
            recipient: walletAddress,
        });
    }

    public static calculateStableTokenTransferTransactionFee(
        amount: string,
        network: SupportedChain
    ) {
        if (!this.SHOULD_CHARGE_TRANSACTION_FEE) return ZERO;

        return fixNumber(calculateStableTokenTransferTransactionFee(network, Number(amount)), TWO);
    }
}

export default WalletAssetManagementService;
