import env from "@/constants/env";
import { Request, Response } from 'express';
import { BAD_REQUEST, OK } from "@/constants/status-codes";
import { HttpException } from "@/resources/exceptions/HttpException";
import logger, { logSync } from "@/resources/logger";
import { handleRequestError } from "@/resources/requestHelpers/handleRequestError";
import HoneyCoinService from "./HoneyCoinService";
import { transactionStatusSchema } from "../FiatRamp/fiatRampSchema";
import { prettifyNumber } from "@/resources/utils/currency";
import userServiceV2 from "@/runtime/user";
import WhatsAppBotService from "../WhatsAppBot/WhatsAppBotService";
import { addCashbackJobToQueue } from "../campaigns/cashbacks/utils";
import { generateOfframpToBankRecipientReceipt } from "../receipts/generators";
import { addCryptoPayoutJobToQueue } from "../crypto-payouts-v2/utils";
import { searchSupportedBlockchain } from "../FiatRamp/utils";
import { isCashBackEnabledChain } from "../campaigns/cashbacks/utils";
import { safeCompare } from "@/resources/utils/safeCompare";


class HoneyCoinController {

    public static receiveWebHookData(req: Request) {

        const signatureHeader = req.headers['x-webhook-signature'] as string | string[];
        const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

        if (!signature) {
            throw new HttpException(BAD_REQUEST, 'Signature is missing from request');
        }

        const HoneyCoinWebhookSecret = env.HONEYCOIN_WEBHOOK_SECRET;

        if (!safeCompare(signature, HoneyCoinWebhookSecret)) {
            throw new HttpException(BAD_REQUEST, 'Invalid signature');
        }

    }

    public static async offRampWebWebhook(req: Request, res: Response) {
        try {
            res.sendStatus(OK);

            HoneyCoinController.receiveWebHookData(req);

            const { data: { status, externalReference: referenceId, type } } = req.body;

            logSync('info', 'HoneyCoin Offramp Webhook Received', { referenceId, type, status });

            if (!HoneyCoinService.eventTypeIsValid(type, 'offramp')) {
                await logger.info(`Invalid Event Type ${type}`);
                return;
            }

            const newTransactionStatus = status === 'successful'
                ? transactionStatusSchema.parse('complete')
                : transactionStatusSchema.parse(status);

            const transaction = await HoneyCoinService.getHoneyCoinOfframpTransaction(referenceId);

            await HoneyCoinService.updateHoneyCoinOfframpTransactionStatus(referenceId, newTransactionStatus);

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

            if (newTransactionStatus === 'pending') {
                message = `⏳ Your transaction with the following details is being processed:\n\n${transactionDetailsString}\n\nPlease be patient`;
            }

            const user = await userServiceV2.getUserById(transaction.ownerId);
            const userPhoneNumber = user?.primaryWhatsappPhoneNumber!;
            const supportedChain = searchSupportedBlockchain(transaction.blockchainNetwork!)

            if (message.trim() && newTransactionStatus !== 'failed') {
                try {
                    await WhatsAppBotService.sendArbitraryTextMessage(userPhoneNumber, message);
                } catch (error) { }
            }

            if (newTransactionStatus === 'complete') {
                if (supportedChain && isCashBackEnabledChain(supportedChain)) {
                    await addCashbackJobToQueue({
                        transactionId: referenceId,
                        transactionType: 'honey-coin-offramp',
                        blockchain: supportedChain,
                    });
                }

                const receiptBuffer = await generateOfframpToBankRecipientReceipt(transaction);
                const uploadedMedia = await WhatsAppBotService.uploadImageToWhatsapp(
                    env.WA_PHONE_NUMBER_ID,
                    new File([Buffer.from(receiptBuffer)], `receipt-${referenceId}.png`, {
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
                try {
                    await WhatsAppBotService.sendArbitraryTextMessage(userPhoneNumber, message);
                } catch (error) { }

                await addCryptoPayoutJobToQueue({
                    transactionId: referenceId,
                    transactionType: 'offramp-honeycoin-refund',
                });
            }

        } catch (error) {
            handleRequestError(error, res, true);
        }
    }

}

export default HoneyCoinController;