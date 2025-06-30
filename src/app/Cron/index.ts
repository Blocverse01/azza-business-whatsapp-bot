import CryptoPayoutCronJobService from '@/app/CryptoPayout/CryptoPayoutCronJobService';
import logger from '@/resources/logger';
import { parseUnknownError } from '@/resources/requestHelpers/handleRequestError';
import cron, { ScheduledTask } from 'node-cron';
import NGNBanksJobService from '../NigeriaBanks/NGNBanksJobService';
import NGNVasJobService from '../ngn-vas-payment/ngn-vas-payment-job';

type JobKeys = 'crypto-payout' | 'ngn-bank-transaction-update' | 'ngn-vas-transaction-update';

class CronHandler {
    private static jobs: Map<JobKeys, ScheduledTask> = new Map<JobKeys, ScheduledTask>();

    private static scheduleFunctionWithCron = (
        key: JobKeys,
        callBackFunc: () => void,
        cronExpression: string
    ) => {
        const job = cron.schedule(cronExpression, callBackFunc);

        void logger.debug(`Job [${key}] scheduled with cron expression: ${cronExpression}`);

        CronHandler.jobs.set(key, job);

        return job;
    };

    public static getCronTasks() {
        return CronHandler.jobs;
    }

    public static pauseCronTask(key: JobKeys) {
        const job = CronHandler.jobs.get(key);

        if (job) {
            job.stop();
        }
    }

    public static resumeCronTask(key: JobKeys) {
        const job = CronHandler.jobs.get(key);

        if (job) {
            job.start();
        }
    }

    public static scheduleCryptoPayoutExecution(cronExpression: string) {
        const key: JobKeys = 'crypto-payout';

        const job = this.scheduleFunctionWithCron(
            key,
            async () => {
                this.pauseCronTask(key);

                try {
                    await CryptoPayoutCronJobService.execute();
                } catch (error) {
                    const parsedError = parseUnknownError(error);

                    void logger.error('Error processing crypto payouts', {
                        error: parsedError,
                    });
                } finally {
                    this.resumeCronTask(key);
                }
            },
            cronExpression
        );

        job.start();
    }

    public static scheduleSafeHavenTransactionUpdate(cronExpression: string) {

        const key: JobKeys = 'ngn-bank-transaction-update';

        const job = this.scheduleFunctionWithCron(
            key,
            async () => {
                this.pauseCronTask(key);

                try {
                    await NGNBanksJobService.execute();
                } catch (error) {
                    const parsedError = parseUnknownError(error);

                    void logger.error('Error updating ngn-bank transaction', {
                        error: parsedError,
                    });
                } finally {
                    this.resumeCronTask(key);
                }
            },
            cronExpression
        );

        job.start();
    }

    public static scheduleSafeHavenVasPaymentUpdate(cronExpression: string) {

        const key: JobKeys = 'ngn-vas-transaction-update';

        const job = this.scheduleFunctionWithCron(
            key,
            async () => {
                this.pauseCronTask(key);

                try {
                    await NGNVasJobService.execute();
                } catch (error) {
                    const parsedError = parseUnknownError(error);

                    void logger.error('Error updating ngn-vas transaction', {
                        error: parsedError,
                    });
                } finally {
                    this.resumeCronTask(key);
                }
            },
            cronExpression
        );

        job.start();
    }
}

export default CronHandler;
