import { BlockradarWebhookPayload } from '@/app/Blockradar/schema';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import crypto from 'node:crypto';

type BlockradarMasterWalletWebhookServiceParams = {
    handleDepositSuccess: (
        data: BlockradarWebhookPayload,
        network: AllSupportedBlockchains
    ) => Promise<void>;
    handleWithdrawalSuccess: (
        data: BlockradarWebhookPayload,
        network: AllSupportedBlockchains
    ) => Promise<void>;
    handleWithdrawalFailed: (
        data: BlockradarWebhookPayload,
        network: AllSupportedBlockchains
    ) => Promise<void>;
    handleSwapSuccess: (
        data: BlockradarWebhookPayload,
        network: AllSupportedBlockchains
    ) => Promise<void>;
    handleSwapFailed: (
        data: BlockradarWebhookPayload,
        network: AllSupportedBlockchains
    ) => Promise<void>;
};

class BlockradarMasterWalletWebhookService {
    private readonly handleDepositSuccess: BlockradarMasterWalletWebhookServiceParams['handleDepositSuccess'];
    private readonly handleWithdrawalSuccess: BlockradarMasterWalletWebhookServiceParams['handleWithdrawalSuccess'];
    private readonly handleWithdrawalFailed: BlockradarMasterWalletWebhookServiceParams['handleWithdrawalFailed'];
    private readonly handleSwapSuccess: BlockradarMasterWalletWebhookServiceParams['handleSwapSuccess'];
    private readonly handleSwapFailed: BlockradarMasterWalletWebhookServiceParams['handleSwapSuccess'];

    constructor(params: BlockradarMasterWalletWebhookServiceParams) {
        this.handleDepositSuccess = params.handleDepositSuccess;
        this.handleWithdrawalSuccess = params.handleWithdrawalSuccess;
        this.handleWithdrawalFailed = params.handleWithdrawalFailed;
        this.handleSwapSuccess = params.handleSwapSuccess;
        this.handleSwapFailed = params.handleSwapFailed;
    }

    public verifyWebhookSignature(params: {
        signatureHeader: string;
        payload: string;
        masterWalletApiKey: string;
    }): boolean {
        const { signatureHeader, payload, masterWalletApiKey } = params;
        const hash = crypto.createHmac('sha512', masterWalletApiKey).update(payload).digest('hex');

        return hash.toLowerCase() === signatureHeader.toLowerCase();
    }

    public async handleWebhook(
        payload: BlockradarWebhookPayload,
        network: AllSupportedBlockchains
    ): Promise<void> {
        if (payload.event === 'deposit.success') {
            await this.handleDepositSuccess(payload, network);
            return;
        }
        if (payload.event === 'withdraw.success') {
            await this.handleWithdrawalSuccess(payload, network);
            return;
        }
        if (payload.event === 'withdraw.failed') {
            await this.handleWithdrawalFailed(payload, network);
            return;
        }
        if (payload.event === 'swap.success') {
            await this.handleSwapSuccess(payload, network);
            return;
        }
        if (payload.event === 'swap.failed') {
            await this.handleSwapFailed(payload, network);
            return;
        }
    }
}

export default BlockradarMasterWalletWebhookService;
