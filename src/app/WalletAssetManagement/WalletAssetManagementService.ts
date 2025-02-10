import { calculateStableTokenTransferTransactionFee } from '@/app/WalletAssetManagement/config';
import { TWO, ZERO } from '@/constants/numbers';
import { fixNumber } from '@/resources/utils/currency';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';

class WalletAssetManagementService {
    public static readonly SHOULD_CHARGE_TRANSACTION_FEE = false;

    public static calculateStableTokenTransferTransactionFee(
        amount: string,
        network: AllSupportedBlockchains
    ) {
        if (!this.SHOULD_CHARGE_TRANSACTION_FEE) return ZERO;

        return fixNumber(calculateStableTokenTransferTransactionFee(network, Number(amount)), TWO);
    }
}

export default WalletAssetManagementService;
