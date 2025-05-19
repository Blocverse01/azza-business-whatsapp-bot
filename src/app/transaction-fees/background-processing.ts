import {
    collectTransactionFee,
    getDeterministicIdFromTxReference,
    getTransactionFeeLogById,
} from '@/app/transaction-fees/utils';
import { queues } from '@/background-processing/queues';
import { CollectFeeQueueInput, QueueNames } from '@/background-processing/types';
import { ConnectionOptions, Worker } from 'bullmq';

export const addFeeCollectionJobToQueue = async (txReference: string) => {
    return await queues.feeCollection.add(
        `Fee collection: ${txReference}`,
        {
            txReference,
        },
        {
            jobId: getDeterministicIdFromTxReference(txReference),
            removeOnFail: false,
            removeOnComplete: {
                age: 24 * 3600, // keep up to 1 day
                count: 1000,
            },
        }
    );
};

const handleCollectionJob = async (data: CollectFeeQueueInput) => {
    const transactionFeeLog = await getTransactionFeeLogById(
        getDeterministicIdFromTxReference(data.txReference)
    );

    if (!transactionFeeLog) {
        throw new Error(`No transaction fee log found for reference: ${data.txReference}`);
    }

    await transactionFeeLog.update({
        status: 'processing',
    });

    return await collectTransactionFee(transactionFeeLog);
};

export const createFeeCollectionWorker = (connection: ConnectionOptions) =>
    new Worker<CollectFeeQueueInput>(
        QueueNames.feeCollection,
        async (job) => {
            return await handleCollectionJob(job.data);
        },
        {
            connection,
            concurrency: 10,
        }
    );
