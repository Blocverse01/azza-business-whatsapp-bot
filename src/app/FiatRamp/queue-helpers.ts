import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { sendTechnicalIssueAlert } from '@/app/support/whatsapp';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { queues } from '@/background-processing/queues';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { OfframpQueueFlowParamsV2 } from '@/background-processing/schema';
import { FiatPayoutQueueResult, OnRampQueueInput, QueueNames } from '@/background-processing/types';
import { OFFRAMP_REQUEST_ERROR_MESSAGE } from '@/constants/strings';
import logger from '@/resources/logger';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import { normalizeBlockchainInput } from '@/resources/web3/core/blockchains';
import azzaWalletManager from '@/runtime/wallet';
import { Worker } from 'bullmq';
import * as math from 'mathjs';
import * as assert from 'node:assert';
import crypto from 'node:crypto';
import { generateOnrampTransactionInitiatedMessage } from '@/resources/utils/bot-message-utils';
import { prettifyNumber } from '@/resources/utils/currency';

export const addOfframpRequestToQueue = async (params: OfframpQueueFlowParamsV2) => {
    const txHashSha256 = crypto.createHash('sha256').update(params.txHash).digest('hex');
    const relevantParts = txHashSha256.slice(0, 16) + txHashSha256.slice(-8);

    const jobId = `fiat-payout-${relevantParts}`;
    return await queues.fiatPayoutV2.add(jobId, params, {
        jobId,
    });
};

export const handleOfframpRequestInQueue = async (
    params: OfframpQueueFlowParamsV2
): Promise<FiatPayoutQueueResult> => {
    const transactionHash = params.txHash.split('_retry')[0];

    const [transaction] = await Promise.all([
        azzaWalletManager.getTransactionByHash(
            transactionHash,
            normalizeBlockchainInput(params.chainName),
            'WITHDRAW'
        ),
    ]);

    if (transaction.status !== 'SUCCESS' || !transaction.confirmed) {
        throw new Error('On-chain transaction failed');
    }

    const transactionAmountIsValid = math.largerEq(transaction.amount, params.tokenAmountDebited);

    assert.ok(
        transactionAmountIsValid,
        `transaction ${params.tokenName} amount (${transaction.amount}) less than expected ${params.tokenName} amount (${params.tokenAmountDebited})`
    );

    try {

        let sequenceId: string;

        if (params.ngnVasSettlementId) {
           
            sequenceId = await FiatRampService.postNgnVasTransaction({
                ...params,
                chainName: params.chainName.toUpperCase(),
                tokenName: params.tokenName.toUpperCase(),
            });
        } else {
            sequenceId = await FiatRampService.postOfframpTransaction({
                ...params,
                chainName: params.chainName.toUpperCase(),
                tokenName: params.tokenName.toUpperCase(),
            });
        }
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

export const addOnRampRequestToQueue = async (jobId: string, params: OnRampQueueInput) => {
    return await queues.onRamp.add(jobId, params, {
        jobId,
        delay: 5000,
    });
};

const sendOnRampPaymentInstructions = async (params: {
    phoneNumber: string;
    accountNumber: string;
    fiatToPay: string;
}) => {
    const { phoneNumber, accountNumber, fiatToPay } = params;

    await WhatsAppBotService.sendArbitraryTextMessage(phoneNumber, accountNumber);

    await WhatsAppBotService.sendArbitraryTextMessage(phoneNumber, fiatToPay);

    await WhatsAppBotService.sendArbitraryTextMessage(
        phoneNumber,
        `🧾 *Payment Instructions:*\n\n 1. 👆 *Long-press* the account number or amount *to copy.*\n\n 2. Please send the payment from *your own bank account*. \n\n 3. Make sure to send the *exact amount* to avoid any delays.`
    );
};

export const handleOnrampRequestInQueue = async (input: OnRampQueueInput) => {
    const { transactionPayload, whatsappParams } = input;
    const onrampResponse = await FiatRampService.postOnRampTransaction(transactionPayload);

    if (onrampResponse.bankInfo === undefined) {
        await WhatsAppBotService.sendArbitraryTextMessage(
            whatsappParams.userPhoneNumber,
            `⚠️ Transaction failed: Couldn't retrieve payment details. Please try again.`
        );
    }

    const message = generateOnrampTransactionInitiatedMessage({
        tokenAmount: transactionPayload.usdAmount.toString(),
        assetNetwork: transactionPayload.chainName,
        assetName: transactionPayload.tokenName,
        bankInfo: onrampResponse.bankInfo!,
        localCurrency: transactionPayload.localCurrency,
        fiatToPay: transactionPayload.localAmount.toString(),
    });

    //send transaction initiated message
    await WhatsAppBotService.sendArbitraryTextMessage(whatsappParams.userPhoneNumber, message);

    //send payment instruction message
    await sendOnRampPaymentInstructions({
        phoneNumber: whatsappParams.userPhoneNumber,
        accountNumber: onrampResponse.bankInfo?.accountNumber!,
        fiatToPay: prettifyNumber(parseFloat(transactionPayload.localAmount.toString())),
    });

    return onrampResponse;
};

export const createOnRampWorker = () => {
    return new Worker<OnRampQueueInput>(
        QueueNames.onRamp,
        async (job) => {
            return handleOnrampRequestInQueue(job.data);
        },
        { connection: connectionConfig, concurrency: 100 }
    );
};
