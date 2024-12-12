import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { YellowCardWebhookPayload } from '@/app/FiatRamp/types';
import env from '@/constants/env';
import { Request, Response } from 'express';
import {
    transactionStatusSchema,
    transactionWebhookPayloadSchema,
} from '@/app/FiatRamp/fiatRampSchema';
import { OK } from '@/constants/status-codes';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { prettifyNumber } from '@/resources/utils/currency';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import logger, { logSync } from '@/resources/logger';
import { ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS } from '@/app/CryptoPayout/config';
import { SUPPORTED_CHAINS } from '@/app/WalletKit/walletKitSchema';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import { TokenNames } from '@/resources/web3/tokens';

class FiatRampServiceController {
    // TODO: replace with better authorization guards
    private static ALLOWED_IPS = ['3.75.158.163', '3.125.183.140', '35.157.117.28'];

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

            if (message.trim())
                await WhatsAppBotService.sendArbitraryTextMessage(transaction.ownerId, message);
        } catch (error) {
            handleRequestError(error, res, true);
        }
    }

    public static async receiveTransactionWebhook(req: Request, res: Response) {
        try {
            //get the origin IP of the request
            let originIp;
            const forwardedIps = req.headers['x-forwarded-for']?.toString().split(',');
            if (forwardedIps) {
                originIp = forwardedIps[0]; // Take the first IP address from X-Forwarded-For header
            } else {
                originIp = req.ip; // Fallback to req.ip if X-Forwarded-For is not available
            }

            void logger.debug('Received transaction webhook', {
                originIp,
                body: req.body,
            });

            //check if the request is coming from an allowed IP
            if (!FiatRampServiceController.ALLOWED_IPS.includes(originIp as string)) {
                return res.status(401).send('Unauthorized');
            }

            res.sendStatus(OK);

            const payload = transactionWebhookPayloadSchema.parse(req.body);

            const { transactionStatus } = payload;

            const transactionKeyword = payload.transactionType === 'off-ramp' ? 'Sell' : 'Buy';
            const transactionPreposition = payload.transactionType === 'off-ramp' ? 'for' : 'with';

            const transactionDetailsString = `💲${transactionKeyword} ${payload.usdAmount} ${payload.tokenName} on ${payload.chainName} ${transactionPreposition} ${payload.localCurrencySymbol} ${prettifyNumber(payload.localAmount)}`;

            let message = '';

            if (transactionStatus === 'complete') {
                message = `✅ Your transaction with the following details has been completed:\n\n${transactionDetailsString}\n\nExpect your funds within 1 - 5 minutes`;
            }
            if (transactionStatus === 'failed') {
                message = `❌ Your transaction with the following details has failed:\n\n${transactionDetailsString}\n\nPlease contact support for assistance`;
            }

            if (transactionStatus === 'processing') {
                message = `⏳ Your transaction with the following details is being processed:\n\n${transactionDetailsString}\n\nPlease be patient`;
            }

            if (message.trim())
                await WhatsAppBotService.sendArbitraryTextMessage(
                    payload.transactionOwnerId,
                    message
                );

            if (
                payload.transactionType === 'on-ramp' &&
                transactionStatus === 'complete' &&
                payload.destinationWalletAddress
            ) {
                const supportedChain = SUPPORTED_CHAINS.find(
                    (chain) => chain.toLowerCase() === payload.chainName.toLowerCase()
                );

                if (
                    supportedChain &&
                    ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS.includes(supportedChain)
                ) {
                    await CryptoPayoutService.createOnrampCryptoPayoutOrder({
                        triggerTransactionId: payload.sequenceId,
                        network: supportedChain,
                        tokenSymbol: payload.tokenName as Extract<
                            typeof TokenNames,
                            'USDT' | 'USDC'
                        >,
                        amount: payload.usdAmount,
                        destinationWalletAddress: payload.destinationWalletAddress,
                    });
                }
            }
        } catch (error) {
            handleRequestError(error, res, true);
        }
    }
}

export default FiatRampServiceController;
