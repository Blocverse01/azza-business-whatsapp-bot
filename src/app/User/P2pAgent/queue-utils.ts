import { Worker } from 'bullmq';
import { queues } from "@/background-processing/queues";
import { connectionConfig } from "@/background-processing/redis-connection-config";
import { p2pAgentQueueInput, QueueNames } from "@/background-processing/types";
import P2pAgentService from './P2pAgentService';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import { HUNDRED, ONE, TWO } from '@/constants/numbers';
import { INTERNAL_SERVER_ERROR, NOT_FOUND } from '@/constants/status-codes';
import { HttpException } from '@/resources/exceptions/HttpException';
import { PROVIDER_OFFRAMP_FIXED_FEE, PROVIDER_ONRAMP_FIXED_FEE, SMALL_TXN_THRESHOLD, YELLOWCARD_OFFRAMP_PERCENTAGE, YELLOWCARD_ONRAMP_PERCENTAGE } from './constants';
import { type CountryCode } from 'libphonenumber-js';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { transactionType } from './P2pAgentSchema';
import UserServiceV2 from '../UserServiceV2';
import env from '@/constants/env';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';


export const addP2pAgentTransactionTrackerJobToQueue = async (
    input: p2pAgentQueueInput
) => {
    const jobId = `p2p-agent-transaction-${input.sequenceId}`;
    return queues.p2pAgentTransaction.add(jobId, input, {
        jobId,
        removeOnComplete: false,
        delay: 5000,
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
                sequenceId,
                providerName,
                localCurrencySymbol,
                country,
                transactionFeeUsd
            } = job.data;

            const is2p2AgentTransactionExisting = await P2pAgentService.getP2pAgentTransactionBySequenceId(sequenceId);

            if (is2p2AgentTransactionExisting) {
                throw new HttpException(INTERNAL_SERVER_ERROR, 'P2pAgent transaction already exists');
            }

            const [isP2pAgentCommissionEnabled, p2pAgentCommissionPercentage, user] = await Promise.all([
                FeatureFlagService.isFeatureEnabled(FeatureFlagKey.P2P_AGENT_REWARD),
                P2pAgentService.getP2pAgentCommissionPercentage(),
                UserServiceV2.getUserById(ownerId)
            ]);

            let rewardAmount: number = 0;
            const message = `\n\nHey Agent! \n\nYou just completed a trade 🎉. \n\nCheck your earnings with: */agent_earn* or simply *type agent earnings*. 💸\n\n Keep it up! 🚀\n\n`;

            if (!user?.id) {
                throw new HttpException(NOT_FOUND, 'P2pAgent not found');
            }

            if (isP2pAgentCommissionEnabled) {
                await WhatsAppBotService.sendWhatsappMessage(
                    env.WA_PHONE_NUMBER_ID,
                    MessageGenerators.generateTextMessage(
                        user?.primaryWhatsappPhoneNumber!,
                        message
                    )
                );

                rewardAmount = await calculateAgentReward({
                    transactionAmount: usdAmount,
                    transactionFeeUsd,
                    type: transactionType,
                    countryCode: country as CountryCode,
                    localCurrencySymbol
                })
            }

            const p2pAgentTransaction = await P2pAgentService.createP2pAgentTransaction({
                providerName,
                localCurrencySymbol,
                country,
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


export const calculateAgentReward = async (
    {
        transactionFeeUsd,
        transactionAmount,
        type,
        countryCode,
        localCurrencySymbol
    }: {
        transactionFeeUsd: number,
        transactionAmount: number,
        type: transactionType,
        countryCode: CountryCode,
        localCurrencySymbol: string
    }
): Promise<number> => {

    const quotes = await FiatRampService.getQuotes(
        localCurrencySymbol.toUpperCase(),
        countryCode.toUpperCase() as CountryCode,
        type as transactionType
    )

    let providerPercentage: number;
    let agentReward: number;

    const FIAT_TO_USD_RATE = ONE / quotes.rate

    if (transactionAmount <= SMALL_TXN_THRESHOLD) {
        const providerFixedFeeUsd = FIAT_TO_USD_RATE * getCountryFixedFee(countryCode.toUpperCase() as CountryCode, type);
        const azzaCut = Math.max(0, quotes.minFeeUsd - providerFixedFeeUsd);
        agentReward = azzaCut / TWO;
        return agentReward;
    }

    if (type === 'offramp') {
        providerPercentage = YELLOWCARD_OFFRAMP_PERCENTAGE;
    } else {
        providerPercentage = YELLOWCARD_ONRAMP_PERCENTAGE;
    }
    const providerCut = transactionAmount * (providerPercentage / HUNDRED);
    const azzaCut = Math.max(0, transactionFeeUsd - providerCut);
    agentReward = azzaCut / TWO;
    return agentReward;
};

const getCountryFixedFee = (countryCode: CountryCode, type: transactionType): number => {

    return (() => {
        if (countryCode === 'NG') {
            return type === 'offramp'
                ? PROVIDER_OFFRAMP_FIXED_FEE.NGN_FIXED_FEE
                : PROVIDER_ONRAMP_FIXED_FEE.NGN_FIXED_FEE;
        }

        if (countryCode === 'KE') {
            return type === 'offramp'
                ? PROVIDER_OFFRAMP_FIXED_FEE.KES_FIXED_FEE
                : PROVIDER_ONRAMP_FIXED_FEE.KES_FIXED_FEE;
        }

        throw new Error(`No fixed fee config for country: ${countryCode}`);
    })();
}

