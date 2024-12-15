import WhatsAppFlowController from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppFlowController';
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
        WhatsAppFlowController.offrampFlowDataExchange
    )
    .post(
        '/flows/beneficiary-data-exchange',
        decryptFlowDataExchange,
        WhatsAppFlowController.addBeneficiaryFlowDataExchange
    )
    .post(
        '/flows/wallet-transfer-data-exchange',
        decryptFlowDataExchange,
        WhatsAppFlowController.transferToWalletFlowDataExchange
    )
    .post(
        '/flows/onramp-data-exchange',
        decryptFlowDataExchange,
        WhatsAppFlowController.onRampFlowDataExchange
    )
    .post(
        '/flows/transaction-confirmation',
        decryptFlowDataExchange,
        WhatsAppFlowController.transactionConfirmationFlowDataExchange
    )
    .post(
        '/flows/set-transaction-pin',
        decryptFlowDataExchange,
        WhatsAppFlowController.setTransactionPinFlowDataExchange
    )
    .post(
        '/flows/change-transaction-pin',
        decryptFlowDataExchange,
        WhatsAppFlowController.changeTransactionPinFlowDataExchange
    )
    .post(
        '/flows/reset-transaction-pin',
        decryptFlowDataExchange,
        WhatsAppFlowController.resetTransactionPinFlowDataExchange
    );

export default whatsappBotRoutes;
