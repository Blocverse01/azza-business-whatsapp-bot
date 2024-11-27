import express from 'express';
import WhatsAppBotController from '@/app/WhatsAppBot/WhatsAppBotController';
import decryptFlowDataExchange from '@/resources/middlewares/decryptFlowDataExchange';

const whatsappBotRoutes = express.Router();

whatsappBotRoutes
    .post('/messages/webhook', WhatsAppBotController.receiveMessageWebhook)
    .get('/messages/webhook', WhatsAppBotController.messageWebHookVerification)
    .post(
        '/flows/offramp-data-exchange',
        decryptFlowDataExchange,
        WhatsAppBotController.offrampFlowDataExchange
    )
    .post(
        '/flows/beneficiary-data-exchange',
        decryptFlowDataExchange,
        WhatsAppBotController.addBeneficiaryFlowDataExchange
    )
    .post(
        '/flows/wallet-transfer-data-exchange',
        decryptFlowDataExchange,
        WhatsAppBotController.transferToWalletFlowDataExchange
    )
    .post(
        '/flows/onramp-data-exchange',
        decryptFlowDataExchange,
        WhatsAppBotController.onRampFlowDataExchange
    )
    .post(
        '/flows/transaction-confirmation',
        decryptFlowDataExchange,
        WhatsAppBotController.transactionConfirmationFlowDataExchange
    )
    .post(
        '/flows/set-transaction-pin',
        decryptFlowDataExchange,
        WhatsAppBotController.setTransactionPinFlowDataExchange
    )
    .post(
        '/flows/change-transaction-pin',
        decryptFlowDataExchange,
        WhatsAppBotController.changeTransactionPinFlowDataExchange
    );

export default whatsappBotRoutes;
