import { Worker } from 'bullmq';
import { queues } from "@/background-processing/queues";
import { connectionConfig } from "@/background-processing/redis-connection-config";
import { p2pAgentQueueInput, QueueNames } from "@/background-processing/types";
import P2pAgentService from './P2pAgentService';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import { HUNDRED } from '@/constants/numbers';
import { INTERNAL_SERVER_ERROR } from '@/constants/status-codes';
import { HttpException } from '@/resources/exceptions/HttpException';


export const addP2pAgentTransactionTrackerJobToQueue = async (
    input: p2pAgentQueueInput
) => {
    const jobId = `p2p-agent-transaction-${input.sequenceId}`;
    return queues.p2pAgentTransaction.add(jobId, input, {
        jobId,
        removeOnComplete: false,
    });
};


export const createP2pAgentTransactionTrackerJobWorker = () => {
    return new Worker<p2pAgentQueueInput>(
        QueueNames.p2pAgentTransaction,
        async (job) => {

            const {
                blockchainNetwork,
                localAmount,
                ownerId,
                usdAmount,
                processingStatus,
                tokenSymbol,
                transactionType,
                beneficiaryId,
                sequenceId,
            } = job.data;

            const is2p2AgentTransactionExisting = await P2pAgentService.getP2pAgentTransactionBySequenceId(sequenceId);

            if (is2p2AgentTransactionExisting) {
                throw new HttpException(INTERNAL_SERVER_ERROR, 'p2pAgent transaction already exists');
            }

            const [beneficiary, isP2pAgentCommissionEnabled, p2pAgentCommissionPercentage] = await Promise.all([
                FiatRampService.getBeneficiary(beneficiaryId),
                FeatureFlagService.isFeatureEnabled(FeatureFlagKey.P2P_AGENT_REWARD),
                P2pAgentService.getP2pAgentCommissionPercentage()
            ]);

            let rewardAmount: number = 0;
            let rewardPercentage: number = 0;

            if (isP2pAgentCommissionEnabled) {
                rewardPercentage = (p2pAgentCommissionPercentage?.percentage ?? 0) / HUNDRED;
                rewardAmount = usdAmount * rewardPercentage;
            }

            const p2pAgentTransaction = await P2pAgentService.createP2pAgentTransaction({
                localCurrencySymbol: beneficiary.country.currencySymbol,
                country: beneficiary.country.code,
                blockchainNetwork,
                localAmount,
                ownerId,
                usdAmount,
                processingStatus,
                tokenSymbol,
                transactionType,
                sequenceId,
                rewardAmount,
                rewardPercentage: p2pAgentCommissionPercentage?.percentage ?? 0
            });

            if (p2pAgentTransaction?.id) {
                return await P2pAgentService.updateP2pAgentAccountBalance(ownerId, rewardAmount);
            }
        },
        {
            connection: connectionConfig,
            concurrency: 20,
        }
    );
};

