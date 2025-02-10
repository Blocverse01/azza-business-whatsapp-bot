import express from 'express';
import blockradarRoutes from './blockradarRoutes';
import fiatRampRoutes from './fiatRampRoutes';
import sumSubRoutes from './sumSubRoutes';
import whatsappBotRoutes from './whatsappBotRoutes';

const apiRoutes = express
    .Router()
    .use('/whatsapp', whatsappBotRoutes)
    .use('/sum-sub', sumSubRoutes)
    .use('/fiat-ramp', fiatRampRoutes)
    .use('/blockradar', blockradarRoutes);

export default apiRoutes;
