import { SendOfframpRequestPayload } from '@/app/FiatRamp/fiatRampSchema';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import logger, { logSync } from '@/resources/logger';
import { SupportedChain, TransactionResponse } from '@/app/WalletKit/walletKitSchema';
import {
    ExtendedWalletSupportedNetworks,
    ExtendedWalletTransaction,
} from '@/app/ExtendedWallet/extendedWalletSchema';
import { isExtendedNetwork } from '@/app/ExtendedWallet/utils';
import UserService from '@/app/User/UserService';

export type ProcessOfframpInBackgroundParams = Omit<SendOfframpRequestPayload, 'txHash'> & {
    onChainTransactionId: string;
    network: SupportedChain | ExtendedWalletSupportedNetworks;
    userId: string;
};

const offrampParams: ProcessOfframpInBackgroundParams = JSON.parse(process.argv[2]);

type TransactionDetails = TransactionResponse | ExtendedWalletTransaction;

async function processInBackground(txParams: ProcessOfframpInBackgroundParams) {
    const { onChainTransactionId, userId } = txParams;

    try {
        let transactionDetails: TransactionDetails;

        if (isExtendedNetwork(txParams.network)) {
            const extendedWallet = await UserService.getExtendedWallet(userId, txParams.network);
            transactionDetails = await extendedWallet.getTransaction(onChainTransactionId);
        } else {
            transactionDetails = await WalletKitService.getTransactionById(onChainTransactionId);
        }

        logSync('debug', 'Running process in background', {
            transactionDetails,
        });

        if (transactionDetails.status === 'submitted' || transactionDetails.status === 'pending') {
            setTimeout(() => {
                processInBackground(txParams);
            }, 5000);
        }

        const transactionHash =
            'transaction_hash' in transactionDetails
                ? transactionDetails.transaction_hash
                : transactionDetails.transactionHash;

        if (transactionDetails.status === 'success' && transactionHash) {
            try {
                logSync('debug', 'Processing offramp', {
                    onChainTransactionId,
                });

                const sequenceId = await FiatRampService.postOfframpTransaction({
                    ...txParams,
                    txHash: transactionHash,
                    chainName: txParams.chainName.toUpperCase(),
                    tokenName: txParams.tokenName.toUpperCase(),
                });

                await logger.info('Offramp transaction processed successfully', { sequenceId });
            } catch (error) {
                await logServiceError(error, 'Sending offramp transaction failed');
            }
        }
    } catch (error) {
        await logServiceError(error, 'Background process failed:');
    }
}

processInBackground(offrampParams).then(() => console.log('Process completed'));
