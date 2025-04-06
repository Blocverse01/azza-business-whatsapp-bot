import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { sendTechnicalIssueAlert } from '@/app/support/whatsapp';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { queues } from '@/background-processing/queues';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { OfframpQueueFlowParamsV2 } from '@/background-processing/schema';
import { FiatPayoutQueueResult, QueueNames } from '@/background-processing/types';
import { OFFRAMP_REQUEST_ERROR_MESSAGE } from '@/constants/strings';
import logger from '@/resources/logger';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import { normalizeBlockchainInput } from '@/resources/web3/core/blockchains';
import azzaWalletManager from '@/runtime/wallet';
import { Worker } from 'bullmq';
import * as math from 'mathjs';
import * as assert from 'node:assert';

export const addOfframpRequestToQueue = async (params: OfframpQueueFlowParamsV2) => {
    return await queues.fiatPayoutV2.add(`fiat-payout-${params.txHash}`, params, {
        jobId: `fiat-payout-${params.txHash}`,
    });
};

export const handleOfframpRequestInQueue = async (
    params: OfframpQueueFlowParamsV2
): Promise<FiatPayoutQueueResult> => {
    const [transaction] = await Promise.all([
        azzaWalletManager.getTransactionByHash(
            params.txHash,
            normalizeBlockchainInput(params.chainName)
        ),
    ]);

    if (transaction.status !== 'SUCCESS' || !transaction.confirmed) {
        throw new Error('Onchain transaction failed');
    }

    const expectedUsdAmount = params.usdAmount + params.transactionFeeUsd;
    const transactionUsdAmount = transaction.amount;
    const transactionAmountIsValid = math.largerEq(transactionUsdAmount, expectedUsdAmount);

    assert.ok(
        transactionAmountIsValid,
        `transaction USD amount (${transactionUsdAmount}) less than expected USD amount (${expectedUsdAmount})`
    );

    try {
        const sequenceId = await FiatRampService.postOfframpTransaction({
            ...params,
            chainName: params.chainName.toUpperCase(),
            tokenName: params.tokenName.toUpperCase(),
        });

        return { sequenceId, result: 'SENT' };
    } catch (error) {
        const parsedError = parseUnknownError(error);

        await logger.error(parsedError.message, {
            error: parsedError,
        });

        const technicalIssueAlert = [
            `Offramping with fiat ramps provider failed, with this reason:`,
            parsedError.message,
            `\nPayload: ${JSON.stringify(params)}`,
            `\nIssue level: critical`,
        ].join('\n');

        await sendTechnicalIssueAlert(
            technicalIssueAlert,
            params.whatsappParams.businessPhoneNumberId
        );

        await WhatsAppBotService.sendWhatsappMessage(
            params.whatsappParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.whatsappParams.userPhoneNumber,
                OFFRAMP_REQUEST_ERROR_MESSAGE
            )
        );

        throw new Error(parsedError.message);
    }
};

export const createFiatPayoutV2Worker = () => {
    return new Worker<OfframpQueueFlowParamsV2, FiatPayoutQueueResult>(
        QueueNames.fiatPayoutV2,
        async (job) => {
            return handleOfframpRequestInQueue(job.data);
        },
        { connection: connectionConfig, concurrency: 100 }
    );
};
