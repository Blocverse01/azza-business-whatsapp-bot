import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { YellowCardWebhookPayload } from '@/app/FiatRamp/types';
import UserService from '@/app/User/UserService';
import { searchAsset } from '@/config/whatsAppBot';
import env from '@/constants/env';
import { Request, Response } from 'express';
import { transactionStatusSchema } from '@/app/FiatRamp/fiatRampSchema';
import { OK } from '@/constants/status-codes';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { prettifyNumber } from '@/resources/utils/currency';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import logger, { logSync } from '@/resources/logger';
import { ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS } from '@/app/CryptoPayout/config';
import { SUPPORTED_CHAINS, SupportedChain } from '@/app/WalletKit/walletKitSchema';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import { TokenNames } from '@/resources/web3/tokens';

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

            const transaction = await FiatRampService.getOfframpTransaction(sequenceId);

            const transactionDetailsString = `💲Sell ${transaction.usdAmount} ${transaction.tokenSymbol} on ${transaction.blockchainNetwork} for ${transaction.localCurrencySymbol} ${prettifyNumber(transaction.localAmount)}`;

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

            if (message.trim()) {
                await WhatsAppBotService.sendArbitraryTextMessage(transaction.ownerId, message);
            }

            const supportedChain = SUPPORTED_CHAINS.find(
                (chain) => chain.toLowerCase() === transaction.blockchainNetwork.toLowerCase()
            );

            if (supportedChain && newTransactionStatus === 'failed') {
                if (ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS.includes(supportedChain)) {
                    if (
                        transaction.tokenSymbol === TokenNames.USDC ||
                        transaction.tokenSymbol === TokenNames.USDT
                    ) {
                        const assetConfig = searchAsset({
                            tokenName: transaction.tokenSymbol,
                            network: supportedChain,
                        });

                        const userWalletInfo = await UserService.getUserAssetWalletOrThrow(
                            transaction.ownerId,
                            assetConfig[0].listItemId
                        );

                        await CryptoPayoutService.createOfframpCryptoRefundOrder({
                            network: transaction.blockchainNetwork as SupportedChain,
                            tokenSymbol: transaction.tokenSymbol,
                            triggerTransactionId: transaction.transactionHash,
                            ownerId: transaction.ownerId,
                            amount: transaction.usdAmount,
                            destinationWalletAddress: userWalletInfo.walletAddress,
                        });
                    }
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

            await FiatRampService.updateOnrampTransactionStatus(sequenceId, newTransactionStatus);

            const transaction = await FiatRampService.getOnrampTransaction(sequenceId);

            const transactionDetailsString = `💲Buy ${transaction.usdAmount} ${transaction.tokenSymbol} on ${transaction.blockchainNetwork} with ${transaction.localCurrencySymbol} ${prettifyNumber(transaction.localAmount)}`;

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

            if (message.trim()) {
                await WhatsAppBotService.sendArbitraryTextMessage(transaction.ownerId, message);
            }

            if (newTransactionStatus.toLowerCase() === 'complete') {
                const supportedChain = SUPPORTED_CHAINS.find(
                    (chain) => chain.toLowerCase() === transaction.blockchainNetwork.toLowerCase()
                );

                if (
                    supportedChain &&
                    ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS.includes(supportedChain)
                ) {
                    await CryptoPayoutService.createOnrampCryptoPayoutOrder({
                        triggerTransactionId: transaction.sequenceId,
                        network: supportedChain,
                        tokenSymbol: transaction.tokenSymbol as Extract<
                            typeof TokenNames,
                            'USDT' | 'USDC'
                        >,
                        amount: transaction.usdAmount,
                        destinationWalletAddress: transaction.destinationWalletAddress,
                    });
                }
            }
        } catch (error) {
            handleRequestError(error, res, true);
        }
    }
}

export default FiatRampServiceController;
