import {
    MANUAL_OFFRAMP_PAYMENT_PROCESSOR_ID,
    SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID,
} from '@/app/FiatRamp/config';
import { transactionStatusSchema } from '@/app/FiatRamp/fiatRampSchema';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { YellowCardWebhookPayload } from '@/app/FiatRamp/types';
import { generateOfframpReceipt, generateOnrampReceipt } from '@/app/receipts/generators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { OK } from '@/constants/status-codes';
import logger, { logSync } from '@/resources/logger';
import { handleRequestError } from '@/resources/requestHelpers/handleRequestError';
import { prettifyNumber } from '@/resources/utils/currency';
import userServiceV2 from '@/runtime/user';
import { Request, Response } from 'express';
import { Buffer } from 'node:buffer';
import { addCashbackJobToQueue, isCashBackEnabledChain } from '../campaigns/cashbacks/utils';
import { addCryptoPayoutJobToQueue } from '../crypto-payouts-v2/utils';
import ManualOfframpSettlementService from './alternatives/ManualOfframpSettlementService';
import NigeriaBanksService from '../NigeriaBanks/NigeriaBanksService';
import { getPatchedOnrampTxBySequenceId } from './patches/onramp';
import { Effect } from 'effect';
import { searchSupportedBlockchain } from './utils';

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

            if (transaction.status === 'retried') {
                return;
            }

            await FiatRampService.updateOfframpTransactionStatus(sequenceId, newTransactionStatus);

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
            const userPhoneNumber = user?.primaryWhatsappPhoneNumber!;
            const supportedChain = searchSupportedBlockchain(transaction.blockchainNetwork);

            if (message.trim() && newTransactionStatus !== 'failed') {
                try {
                    await WhatsAppBotService.sendArbitraryTextMessage(userPhoneNumber, message);
                } catch (error) { }
            }

            if (newTransactionStatus === 'complete') {
                if (supportedChain && isCashBackEnabledChain(supportedChain)) {
                    await addCashbackJobToQueue({
                        transactionId: sequenceId,
                        transactionType: 'offramp',
                        blockchain: supportedChain,
                    });
                }

                const receiptBuffer = await generateOfframpReceipt(transaction);
                const uploadedMedia = await WhatsAppBotService.uploadImageToWhatsapp(
                    env.WA_PHONE_NUMBER_ID,
                    new File([Buffer.from(receiptBuffer)], `receipt-${sequenceId}.png`, {
                        type: 'image/png',
                    })
                );

                if (uploadedMedia) {
                    await WhatsAppBotService.sendMediaMessage(
                        {
                            userPhoneNumber,
                            businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        },
                        {
                            media: uploadedMedia,
                            caption: `🧾Transaction Receipt`,
                            type: 'image',
                        }
                    );
                }

                return;
            }

            if (supportedChain && newTransactionStatus === 'failed') {
                const correspondingManualPaymentSequenceId = sequenceId.replace(
                    'azza-p',
                    MANUAL_OFFRAMP_PAYMENT_PROCESSOR_ID
                );
                const correspondingSafeHavenPaymentSequenceId = sequenceId.replace(
                    'azza-p',
                    SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID
                );
                const matchingAlternativePayment =
                    await ManualOfframpSettlementService.getManualOfframpSettlementBySequenceId(
                        correspondingManualPaymentSequenceId
                    );
                // ??
                // (await (async() => {
                //     try {
                //         return await NigeriaBanksService.getNGNBankOfframpTransactionBySequenceId(
                //             correspondingSafeHavenPaymentSequenceId
                //         )
                //     } catch(error) {

                //         return null;
                //     }
                // })());

                if (matchingAlternativePayment) {
                    // Already settled alternatively
                    await logger.info(
                        `Offramp transaction ${sequenceId} has already been settled alternative with sequenceId ${matchingAlternativePayment.sequenceId}`
                    );
                    return;
                }

                try {
                    await WhatsAppBotService.sendArbitraryTextMessage(userPhoneNumber, message);
                } catch (error) { }

                await addCryptoPayoutJobToQueue({
                    transactionId: sequenceId,
                    transactionType: 'offramp-refund',
                });
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
                await Effect.runPromise(getPatchedOnrampTxBySequenceId(sequenceId)),
                FiatRampService.updateOnrampTransactionStatus(sequenceId, newTransactionStatus),
            ]);

            const transactionDetailsString = `💲Buy ${transaction.tokenAmount ?? transaction.usdAmount} ${transaction.tokenSymbol} on ${transaction.blockchainNetwork} with ${transaction.localCurrencySymbol} ${prettifyNumber(transaction.localAmount)}`;

            let message = '';

            if (newTransactionStatus === 'complete') {
                message = `✅ Your transaction with the following details has been completed:\n\n${transactionDetailsString}\n\nExpect your funds within 1 - 5 minutes`;
            }
            if (newTransactionStatus === 'failed') {
                message = `❌ Your transaction with the following details has failed:\n\n${transactionDetailsString}\n\nPlease contact support for assistance`;
            }

            // if (newTransactionStatus === 'processing' || newTransactionStatus === 'process') {
            //     message = `⏳ Your transaction with the following details is being processed:\n\n${transactionDetailsString}\n\nPlease be patient`;
            // }

            const user = await userServiceV2.getUserById(transaction.ownerId);
            const userPhoneNumber = user?.primaryWhatsappPhoneNumber;

            if (message.trim() && userPhoneNumber) {
                try {
                    await WhatsAppBotService.sendArbitraryTextMessage(userPhoneNumber, message);
                } catch (error) { }
            }

            if (newTransactionStatus.toLowerCase() === 'complete') {
                const supportedChain = searchSupportedBlockchain(transaction.blockchainNetwork);

                if (supportedChain) {
                    await addCryptoPayoutJobToQueue({
                        transactionId: sequenceId,
                        transactionType: 'onramp-payout',
                    });

                    if (supportedChain && isCashBackEnabledChain(supportedChain)) {
                        await addCashbackJobToQueue({
                            transactionId: sequenceId,
                            transactionType: 'onramp',
                            blockchain: supportedChain,
                        });
                    }
                }

                const receiptBuffer = await generateOnrampReceipt(transaction);
                const uploadedMedia = await WhatsAppBotService.uploadImageToWhatsapp(
                    env.WA_PHONE_NUMBER_ID,
                    new File([Buffer.from(receiptBuffer)], `receipt-${sequenceId}.png`, {
                        type: 'image/png',
                    })
                );

                if (uploadedMedia) {
                    await WhatsAppBotService.sendMediaMessage(
                        {
                            userPhoneNumber: userPhoneNumber!,
                            businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        },
                        {
                            media: uploadedMedia,
                            caption: `🧾Transaction Receipt`,
                            type: 'image',
                        }
                    );
                }
            }
        } catch (error) {
            handleRequestError(error, res, true);
        }
    }
}

export default FiatRampServiceController;
