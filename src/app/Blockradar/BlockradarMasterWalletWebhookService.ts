import { BlockradarWebhookPayload } from '@/app/Blockradar/schema';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import crypto from 'node:crypto';

type BlockradarMasterWalletWebhookServiceParams = {
    handleDepositSuccess: (
        data: BlockradarWebhookPayload,
        network: AllSupportedBlockchains
    ) => Promise<void>;
};

class BlockradarMasterWalletWebhookService {
    private readonly handleDepositSuccess: BlockradarMasterWalletWebhookServiceParams['handleDepositSuccess'];

    constructor(params: BlockradarMasterWalletWebhookServiceParams) {
        this.handleDepositSuccess = params.handleDepositSuccess;
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
        }
    }
}

export default BlockradarMasterWalletWebhookService;
