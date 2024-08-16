import express from 'express';
import whatsappBotRoutes from './whatsappBotRoutes';
import sumSubRoutes from '@/Routes/sumSubRoutes';
import fiatRampRoutes from '@/Routes/fiatRampRoutes';
import alchemyNotifyRoutes from '@/Routes/alchemyNotifyRoutes';
import testRoutes from '@/Routes/testRoutes';

const apiRoutes = express
    .Router()
    .use('/whatsapp', whatsappBotRoutes)
    .use('/sum-sub', sumSubRoutes)
    .use('/fiat-ramp', fiatRampRoutes)
    .use('/alchemy-notify', alchemyNotifyRoutes)
    .use('/test', testRoutes);

export default apiRoutes;
