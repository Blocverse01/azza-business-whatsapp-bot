import express, { type Request } from 'express';
import { NOT_FOUND, OK } from '@/constants/status-codes';
import env from '@/constants/env';
import apiRoutes from './routes';
import logger from '@/resources/logger';
import CronHandler from '@/app/Cron';
import { CRYPTO_PAYOUTS_EXECUTION_CRON_EXPRESSION } from '@/config/backgroundJobs';
import { addAlchemyContextToRequest } from '@/app/AlchemyNotify/webhookUtils';

const app = express();

// middleware for capturing raw body
app.use(
    express.json({
        limit: '5mb',
        verify: (req: Request, res, buf, encoding: BufferEncoding) => {
            req.rawBody = buf.toString();
            addAlchemyContextToRequest(req, res, buf, encoding);
        },
    })
);

app.get('/', async (_, res) => {
    res.status(OK).send('API welcomes you :)');
});

app.use('/api', apiRoutes, async () => {
    // flush logs: ensure all logs are sent
    const startFlush = Date.now();
    await logger.flush();
    console.log(`Flushing logs took ${Date.now() - startFlush}ms`);
});

app.all('*', (_, res) => res.status(NOT_FOUND).send({ message: 'route not found' }));

app.listen(env.PORT, () => {
    console.log(`🚀 Server ready at: http://localhost:${env.PORT}`);
});

if (env.SHOULD_EXECUTE_CRYPTO_PAYOUTS) {
    CronHandler.scheduleCryptoPayoutExecution(CRYPTO_PAYOUTS_EXECUTION_CRON_EXPRESSION);
}
