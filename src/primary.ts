import CronHandler from '@/app/Cron';
import { CRYPTO_PAYOUTS_EXECUTION_CRON_EXPRESSION } from '@/config/backgroundJobs';
import env from '@/constants/env';
import cluster from 'cluster';
import os from 'os';
import './app/globalErrorHandler';

if (cluster.isPrimary) {
    const numCPUs = os.cpus().length;

    console.log(`Master ${process.pid} is running`);

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died`);
        // Optionally, you can restart the worker
        cluster.fork();
    });

    if (env.SHOULD_EXECUTE_CRYPTO_PAYOUTS) {
        CronHandler.scheduleCryptoPayoutExecution(CRYPTO_PAYOUTS_EXECUTION_CRON_EXPRESSION);
    }

    import('./background-processing/single-instance-workers');
} else {
    // Your worker code here
    import('./');
    console.log(`Worker ${process.pid} started`);
}
