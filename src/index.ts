import CronHandler from '@/app/Cron';
import { queues } from '@/background-processing/queues';
import { SAFEHAVEN_TX_UPDATE_CRON_EXPRESSION } from '@/config/backgroundJobs';
import env from '@/constants/env';
import { NOT_FOUND, OK } from '@/constants/status-codes';
import logger from '@/resources/logger';
import { authenticateAdmin } from '@/resources/middlewares/authenticateBullDashboardAdmin';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import compression from 'compression';
import CookieParser from 'cookie-parser';
import express, { type Request } from 'express';
import apiRoutes from './routes';
import './background-processing/workers';
import './app/globalErrorHandler';
import './background-processing/single-instance-workers';

const app = express();

app.use(compression());
// middleware for capturing raw body
app.use(
    express.json({
        limit: '10mb',
        verify: (req: Request, _res, buf) => {
            req.rawBody = buf.toString();
        },
    })
);

//middleware for cookies
app.use(CookieParser());

app.get('/', async (_, res) => {
    res.status(OK).send('API welcomes you :)');
});

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/bjs/ui');

createBullBoard({
    queues: [
        // new BullMQAdapter(queues.fiatPayout),
        new BullMQAdapter(queues.cryptoDebit),
        new BullMQAdapter(queues.cryptoDebitConfirmation),
        new BullMQAdapter(queues.userTxPinSecurity),
        new BullMQAdapter(queues.walletMigration),
        //new BullMQAdapter(queues.whatsappBotMessaging),
        new BullMQAdapter(queues.whatsappBroadcast),
        new BullMQAdapter(queues.eventDrivenOfframp),
        new BullMQAdapter(queues.fiatPayoutV2),
        new BullMQAdapter(queues.whatsappBotMessagingTemp),
        new BullMQAdapter(queues.syncUserWallet),
        new BullMQAdapter(queues.baseCashback),
        new BullMQAdapter(queues.cryptoPayout),
        new BullMQAdapter(queues.cleanupMessages),
        new BullMQAdapter(queues.handleSmileKycWebhook),
        new BullMQAdapter(queues.handleSafeHavenTransactionStatusUpdate),
        new BullMQAdapter(queues.generateAzzaWrapped),
        new BullMQAdapter(queues.onRamp),
        new BullMQAdapter(queues.blockradarAddressSwaps),
    ],
    serverAdapter: serverAdapter,
});

app.use('/bjs/ui', authenticateAdmin, serverAdapter.getRouter());

app.use('/api', apiRoutes, async () => {
    // flush logs: ensure all logs are sent
    await logger.flush();
});

app.all('*', (_, res) => res.status(NOT_FOUND).send({ message: 'route not found' }));

app.listen(env.PORT, () => {
    console.log(`🚀 Server ready at: http://localhost:${env.PORT}`);
});

if (env.EXECUTE_SAFEHAVEN_TX_STATUS_UPDATE) {
    CronHandler.scheduleSafeHavenTransactionUpdate(SAFEHAVEN_TX_UPDATE_CRON_EXPRESSION);
}
