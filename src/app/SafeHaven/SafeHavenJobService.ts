import logger from "@/resources/logger";
import SafeHavenService from "./SafeHavenService";
import { prettifyNumber } from "@/resources/utils/currency";
import userServiceV2 from "@/runtime/user";
import env from "@/constants/env";
import { addCashbackJobToQueue } from "../campaigns/base-cashbacks/utils";
import azzaWalletManager from "@/runtime/wallet";
import { generateOfframpToBankRecipientReceipt } from "../receipts/generators";
import { addCryptoPayoutJobToQueue } from "../crypto-payouts-v2/utils";
import { HttpException } from "@/resources/exceptions/HttpException";
import { INTERNAL_SERVER_ERROR } from "@/constants/status-codes";
import { transactionStatusSchema } from "../FiatRamp/fiatRampSchema";
import { Buffer } from 'node:buffer';
import WhatsAppBotService from "../WhatsAppBot/WhatsAppBotService";


class SafeHavenJobService {

    public static async execute() {

        try {
            const settlements = await SafeHavenService.getSafeHavenOfframpPendingTransactions();

            void logger.info(`Updating  ${settlements.length} safehaven off-ramp transactions`);

            if (settlements.length > 0) {

                settlements.map(async (settlement) => {

                    await settlement.update({
                        processingStatus: transactionStatusSchema.parse("processing")
                    })

                    const transaction = await SafeHavenService.getSafeHavenTransactionBySessionId(settlement.sessionId as string);

                    const totalAmount = prettifyNumber(
                        (settlement.usdAmount ?? 0) + (settlement.transactionFeeUsd ?? 0)
                    );

                    const userPhoneNumber = await userServiceV2.getUserPhoneNumber(settlement.ownerId as string);

                    const transactionDetailsString = `💲Sell ${totalAmount} ${settlement.tokenSymbol} on ${settlement.blockchainNetwork} for ${settlement.localCurrencySymbol} ${prettifyNumber(settlement!.localAmount!)}`;


                    const supportedChain = settlement.blockchainNetwork
                        ? azzaWalletManager
                            .getSupportedNetworks()
                            .find(
                                (chain) =>
                                    chain.toLowerCase() === settlement.blockchainNetwork!.toLowerCase()
                            )
                        : undefined;

                    if (transaction.status.toLowerCase() === 'completed') {

                        await settlement.update({
                            processingStatus: transactionStatusSchema.parse("complete")
                        })

                        const completeMessage = SafeHavenService.TransactionCompleteMessage(transactionDetailsString)

                        await SafeHavenService.sendArbitraryTextMessage(completeMessage, userPhoneNumber);

                        if (supportedChain === 'Base') {
                            await addCashbackJobToQueue({
                                transactionId: settlement.sequenceId!,
                                transactionType: 'safehaven-offramp',
                            });
                        }

                        const receiptBuffer = await generateOfframpToBankRecipientReceipt({
                            status: 'complete',
                            blockchainNetwork: settlement.blockchainNetwork!,
                            usdAmount: settlement.usdAmount!,
                            localAmount: settlement.localAmount!,
                            localCurrencySymbol: settlement.localCurrencySymbol!,
                            tokenSymbol: settlement.tokenSymbol!,
                            ownerId: settlement.ownerId!,
                            transactionHash: settlement.transactionHash!,
                            transactionFeeUsd: settlement.transactionFeeUsd!,
                            destination: {
                                accountName: settlement.destinationAccountName!,
                                accountNumber: settlement.destinationAccountNumber!,
                                networkName: settlement.destinationNetworkName!,
                                networkId: '',
                                country: settlement.country!,
                                accountType: 'bank'
                            },
                            createdAt: settlement.xata.createdAt.toISOString(),
                            rate: settlement.conversionRate!,
                            sequenceId: settlement.sequenceId!,
                            hotWalletAddress: settlement.hotWalletAddress!,
                            platformFeePercentage: settlement.platformFeePercentage!,
                            fromWalletAddress: settlement.fromWalletAddress!,
                            tokenAddress: settlement.tokenAddress!,
                        });

                        const uploadedMedia = await WhatsAppBotService.uploadImageToWhatsapp(
                            env.WA_PHONE_NUMBER_ID,
                            new File([Buffer.from(receiptBuffer)], `receipt-${settlement.sequenceId}.png`, {
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
                                    mediaId: uploadedMedia.id,
                                    caption: `🧾Transaction Receipt`,
                                    type: 'image',
                                }
                            );
                        }

                        return;
                    }

                    if (transaction.status !== 'completed' || transaction.isReversed) {

                        await settlement.update({
                            processingStatus: transactionStatusSchema.parse("failed")
                        })

                        const failedMessage = SafeHavenService.TransactionFailedMessage(transactionDetailsString);

                        await SafeHavenService.sendArbitraryTextMessage(failedMessage, userPhoneNumber);

                        await addCryptoPayoutJobToQueue({
                            transactionId: settlement.sequenceId!,
                            transactionType: 'offramp-refund',
                        });
                    }
                })
            } else {
                void logger.info(`No safehaven off-ramp settlements found...`);
            }
        } catch (error) {
            throw new HttpException(INTERNAL_SERVER_ERROR, 'Error getting safehaven off-ramp settlements')
        }
    }

}

export default SafeHavenJobService;


