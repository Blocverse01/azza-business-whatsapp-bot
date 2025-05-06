import { SwapTokensTransactionDetailsV2 } from '@/app/azza/azza.schema';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import { dbClient } from '@/db/dbClient';

class SwapService {
    private static readonly SWAPS_REPOSITORY = dbClient.swap_transactions;
    public static readonly EXTERNAL_REFERENCE_PREFIX = 'swaps_';
    public static readonly SWAP_WITHDRAWAL_TX_REASON = 'swap';

    public static async createOrRecoverSwapTransaction(
        jobId: string,
        params: SwapTokensTransactionDetailsV2
    ) {
        if (jobId.trim() === '') {
            throw new Error('Job id is required');
        }

        const fromToken = getAssetConfigOrThrow(params.fromTokenId);
        const toToken = getAssetConfigOrThrow(params.toTokenId);

        const existingTransaction = await this.SWAPS_REPOSITORY.filter({
            jobId: jobId,
        }).getFirst();

        if (existingTransaction) {
            return `${this.EXTERNAL_REFERENCE_PREFIX}${existingTransaction.id}`;
        }

        const newRecord = await this.SWAPS_REPOSITORY.create({
            jobId,
            fromAmount: params.fromAmount,
            quoteToAmount: params.toAmount,
            quoteRate: params.rate,
            fromBlockchain: fromToken.network,
            toBlockchain: toToken.network,
            fromTokenSymbol: fromToken.tokenName,
            toTokenSymbol: toToken.tokenName,
            fee: params.transactionFee,
            user: params.userId,
            recipientAddress: params.recipientAddress,
        });
        return `${this.EXTERNAL_REFERENCE_PREFIX}${newRecord.id}`;
    }

    public static async getSwapTransactionById(id: string) {
        return await this.SWAPS_REPOSITORY.read(id);
    }

    public static async getSwapTransactionByExternalReference(reference: string) {
        if (!reference.startsWith(this.EXTERNAL_REFERENCE_PREFIX)) {
            return null;
        }
        const encodedId = reference.split(this.EXTERNAL_REFERENCE_PREFIX)[1];
        return this.getSwapTransactionById(encodedId);
    }
}

export default SwapService;
