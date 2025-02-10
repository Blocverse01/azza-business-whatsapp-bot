import { SendTransferTransactionResponse } from '@/app/azza/lib/azza.lib.transaction';
import { delay } from '@/resources/utils/delay';
import { getTransactionExplorerUrl } from '@/resources/web3/core/explorerUrls';
import azzaWalletManager from '@/runtime/wallet';

const finalStateStatuses = ['success', 'failed'] as const;

type FinalStateStatus = (typeof finalStateStatuses)[number];

export const waitForTransactionReceipt = async function waitForTransactionReceipt(
    transaction: SendTransferTransactionResponse
) {
    return waitForTransactionReceiptV2(transaction);
};

export async function waitForTransactionReceiptV2(
    transaction: Pick<SendTransferTransactionResponse, 'transactionId' | 'asset' | 'walletManager'>
) {
    const { transactionId, asset, walletManager } = transaction;

    if (walletManager !== 'new') {
        throw new Error('Incompatible transaction params');
    }

    const assetTransaction = await azzaWalletManager.getTransaction(transactionId, asset.network);

    if (assetTransaction.status === 'PENDING') {
        await delay(5000);
        return waitForTransactionReceiptV2(transaction);
    }

    const transactionHash = assetTransaction.hash;

    return {
        transactionHash,
        status: assetTransaction.status.toLowerCase() as FinalStateStatus,
        explorerUrl: transactionHash
            ? getTransactionExplorerUrl(transactionHash as string, asset.network)
            : null,
    };
}
