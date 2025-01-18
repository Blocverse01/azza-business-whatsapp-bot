import { waitForTransactionReceiptV2 } from '@/app/azza/lib/azza.lib.wait-for-transaction-receipt';
import { CryptoPayoutOrderStatus } from '@/app/CryptoPayout/cryptoPayoutSchema';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import { AssetConfig } from '@/resources/web3/tokens';

export type GetTransactionReceiptInBackgroundParams = {
    orderId: string;
    transactionId: string;
    asset: AssetConfig;
};

const args: GetTransactionReceiptInBackgroundParams = JSON.parse(process.argv[2]);

async function getTransactionReceiptInBackground(params: GetTransactionReceiptInBackgroundParams) {
    const { orderId, transactionId, asset } = params;

    try {
        const transactionReceipt = await waitForTransactionReceiptV2({
            transactionId,
            asset,
            walletManager: 'new',
        });

        const newStatus =
            transactionReceipt.status === 'success'
                ? CryptoPayoutOrderStatus.COMPLETE
                : CryptoPayoutOrderStatus.FAILED;

        await CryptoPayoutService.updateProcessedCryptPayoutOrder(orderId, {
            status: newStatus,
            payoutTransactionHash: transactionReceipt.transactionHash,
        });
    } catch (error) {
        console.error('Error getting transaction receipt', error);
    }
}

void getTransactionReceiptInBackground(args);
