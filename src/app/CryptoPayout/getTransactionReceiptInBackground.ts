import WalletKitService from '@/app/WalletKit/WalletKitService';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import { CryptoPayoutOrderStatus } from '@/app/CryptoPayout/cryptoPayoutSchema';
import { delay } from '@/resources/utils/delay';

export type GetTransactionReceiptInBackgroundParams = {
    orderIds: string[];
    transactionId: string;
};

const args: GetTransactionReceiptInBackgroundParams = JSON.parse(process.argv[2]);

async function getTransactionReceiptInBackground(params: GetTransactionReceiptInBackgroundParams) {
    const { orderIds, transactionId } = params;

    try {
        const transaction = await WalletKitService.getTransactionById(transactionId);

        if (transaction.status === 'submitted' || transaction.status === 'pending') {
            await delay(5000);
            return getTransactionReceiptInBackground(params);
        }

        if (transaction.status === 'success' && transaction.transaction_hash) {
            await CryptoPayoutService.updateCryptoPayoutOrdersStatus(
                orderIds,
                CryptoPayoutOrderStatus.COMPLETE
            );
        }

        if (transaction.status === 'failed') {
            await CryptoPayoutService.updateCryptoPayoutOrdersStatus(
                orderIds,
                CryptoPayoutOrderStatus.FAILED
            );
        }

        if (transaction.transaction_hash) {
            await CryptoPayoutService.updateCryptoPayoutOrdersTransactionHash(
                orderIds,
                transaction.transaction_hash
            );
        }
    } catch (error) {
        console.error('Error getting transaction receipt', error);
    }
}

void getTransactionReceiptInBackground(args);
