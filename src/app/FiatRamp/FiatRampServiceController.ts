import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import { transactionStatusSchema } from '@/app/FiatRamp/fiatRampSchema';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { YellowCardWebhookPayload } from '@/app/FiatRamp/types';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { OK } from '@/constants/status-codes';
import logger, { logSync } from '@/resources/logger';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { fixNumber, prettifyNumber } from '@/resources/utils/currency';
import { TokenNames } from '@/resources/web3/tokens';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { Request, Response } from 'express';

class FiatRampServiceController {
    public static receiveWebHookData(req: Request) {
        const { body } = req;
        const signatureHeader = req.header('X-YC-Signature') as string | string[];
        const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

        const data = FiatRampService.validateWebHookData(
            signature,
            body,
            env.YC_WEBHOOK_SECRET_KEY
        ) satisfies YellowCardWebhookPayload;

        const { status, event, ...other } = data;
        const yellowCardStatus = status.toLowerCase();

        return { yellowCardStatus, ...other, webhookEvent: event };
    }

    public static async offRampWebWebhook(req: Request, res: Response) {
        try {
            logSync('info', 'Offramp Webhook Received', req.body);

            res.sendStatus(OK);

            const { sequenceId, yellowCardStatus, webhookEvent } =
                FiatRampServiceController.receiveWebHookData(req);

            if (!FiatRampService.eventTypeIsValid(webhookEvent, 'offramp')) {
                await logger.info(`Invalid Event Type ${webhookEvent}`);

                return;
            }

            const newTransactionStatus = transactionStatusSchema.parse(
                yellowCardStatus.toLowerCase()
            );

            const [transaction] = await Promise.all([
                FiatRampService.getOfframpTransaction(sequenceId),
                FiatRampService.updateOfframpTransactionStatus(sequenceId, newTransactionStatus),
            ]);

            const totalAmount = prettifyNumber(
                transaction.usdAmount + transaction.transactionFeeUsd,
                3
            );

            const transactionDetailsString = `💲Sell ${totalAmount} ${transaction.tokenSymbol} on ${transaction.blockchainNetwork} for ${transaction.localCurrencySymbol} ${prettifyNumber(transaction.localAmount)}`;

            let message = '';

            if (newTransactionStatus === 'complete') {
                message = `✅ Your transaction with the following details has been completed:\n\n${transactionDetailsString}\n\nExpect your funds within 1 - 5 minutes`;
            }
            if (newTransactionStatus === 'failed') {
                message = `❌ Your transaction with the following details has failed:\n\n${transactionDetailsString}\n\nPlease contact support for assistance`;
            }

            if (newTransactionStatus === 'processing') {
                message = `⏳ Your transaction with the following details is being processed:\n\n${transactionDetailsString}\n\nPlease be patient`;
            }

            const user = await userServiceV2.getUserById(transaction.ownerId);
            const userPhoneNumber = user?.primaryWhatsappPhoneNumber;

            if (message.trim() && userPhoneNumber) {
                await WhatsAppBotService.sendArbitraryTextMessage(userPhoneNumber, message);
            }

            const supportedChain = azzaWalletManager
                .getSupportedNetworks()
                .find(
                    (chain) => chain.toLowerCase() === transaction.blockchainNetwork.toLowerCase()
                );

            if (supportedChain && newTransactionStatus === 'failed') {
                if (
                    transaction.tokenSymbol === TokenNames.USDC ||
                    transaction.tokenSymbol === TokenNames.USDT
                ) {
                    const assetConfig = azzaWalletManager.searchAssets({
                        tokenName: transaction.tokenSymbol,
                        network: supportedChain,
                    });

                    if (!user) {
                        return;
                    }

                    const userWalletInfo = await azzaWalletManager.getUserWallet(
                        user.id,
                        assetConfig[0].network
                    );

                    const totalAmount = fixNumber(
                        transaction.usdAmount + transaction.transactionFeeUsd,
                        3
                    );
                    await CryptoPayoutService.createOfframpCryptoRefundOrder({
                        network: supportedChain,
                        tokenSymbol: transaction.tokenSymbol,
                        triggerTransactionId: transaction.transactionHash,
                        amount: totalAmount,
                        destinationWalletAddress: userWalletInfo.address,
                        payoutType: 'offramp-refund',
                    });
                }
            }
        } catch (error) {
            handleRequestError(error, res, true);
        }
    }

    public static async onRampWebWebhook(req: Request, res: Response) {
        try {
            logSync('info', 'Onramp Webhook Received', req.body);

            res.sendStatus(OK);

            const { sequenceId, yellowCardStatus, webhookEvent } =
                FiatRampServiceController.receiveWebHookData(req);

            if (!FiatRampService.eventTypeIsValid(webhookEvent, 'onramp')) {
                await logger.info(`Invalid Event Type ${webhookEvent}`);

                return;
            }

            const newTransactionStatus = transactionStatusSchema.parse(
                yellowCardStatus.toLowerCase()
            );

            const [transaction] = await Promise.all([
                FiatRampService.getOnrampTransaction(sequenceId),
                FiatRampService.updateOnrampTransactionStatus(sequenceId, newTransactionStatus),
            ]);

            const transactionDetailsString = `💲Buy ${transaction.usdAmount} ${transaction.tokenSymbol} on ${transaction.blockchainNetwork} with ${transaction.localCurrencySymbol} ${prettifyNumber(transaction.localAmount)}`;

            let message = '';

            if (newTransactionStatus === 'complete') {
                message = `✅ Your transaction with the following details has been completed:\n\n${transactionDetailsString}\n\nExpect your funds within 1 - 5 minutes`;
            }
            if (newTransactionStatus === 'failed') {
                message = `❌ Your transaction with the following details has failed:\n\n${transactionDetailsString}\n\nPlease contact support for assistance`;
            }

            if (newTransactionStatus === 'processing' || newTransactionStatus === 'process') {
                message = `⏳ Your transaction with the following details is being processed:\n\n${transactionDetailsString}\n\nPlease be patient`;
            }

            const user = await userServiceV2.getUserById(transaction.ownerId);
            const userPhoneNumber = user?.primaryWhatsappPhoneNumber;

            if (message.trim() && userPhoneNumber) {
                await WhatsAppBotService.sendArbitraryTextMessage(userPhoneNumber, message);
            }

            if (newTransactionStatus.toLowerCase() === 'complete') {
                const supportedChain = azzaWalletManager
                    .getSupportedNetworks()
                    .find(
                        (chain) =>
                            chain.toLowerCase() === transaction.blockchainNetwork.toLowerCase()
                    );

                if (supportedChain) {
                    await CryptoPayoutService.createOnrampCryptoPayoutOrder({
                        triggerTransactionId: transaction.sequenceId,
                        network: supportedChain,
                        tokenSymbol: transaction.tokenSymbol as Extract<
                            typeof TokenNames,
                            'USDT' | 'USDC'
                        >,
                        amount: transaction.usdAmount,
                        destinationWalletAddress: transaction.destinationWalletAddress,
                        payoutType: 'onramp-payment',
                    });
                }
            }
        } catch (error) {
            handleRequestError(error, res, true);
        }
    }
}

export default FiatRampServiceController;
