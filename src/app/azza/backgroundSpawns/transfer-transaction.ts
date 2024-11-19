import { TransferAssetTransactionDetails } from '@/app/azza/azza.schema';
import { sendTransferAssetTransaction } from '@/app/azza/lib/azza.lib.transaction';

/**
 * This script is used to send a transfer asset transaction to the blockchain.
 * It is spawned in the background by the `WhatsAppBotTransactionConfirmationFlowService`.
 * It takes in a JSON stringified `TransferAssetTransactionDetails` object as an argument.
 * Script files should not be imported into other files. Or else, the script will be executed when the file is imported.
 */
const transactionParams: TransferAssetTransactionDetails = JSON.parse(process.argv[2]);

void sendTransferAssetTransaction(transactionParams);
