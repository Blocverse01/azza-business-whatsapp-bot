import express from 'express';
import whatsappBotRoutes from './whatsappBotRoutes';
import sumSubRoutes from '@/routes/sumSubRoutes';
import fiatRampRoutes from '@/routes/fiatRampRoutes';
import alchemyNotifyRoutes from '@/routes/alchemyNotifyRoutes';
import testRoutes from '@/routes/testRoutes';

const apiRoutes = express
    .Router()
    .use('/whatsapp', whatsappBotRoutes)
    .use('/sum-sub', sumSubRoutes)
    .use('/fiat-ramp', fiatRampRoutes)
    .use('/alchemy-notify', alchemyNotifyRoutes)
    .use('/test', testRoutes);

export default apiRoutes;
