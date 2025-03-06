import {
    ACKNOWLEDGE_BUTTON_ID_PREFIX,
    MANUAL_OFFRAMP_SETTLERS,
    MARK_AS_PAID_BUTTON_ID_PREFIX,
} from '@/app/FiatRamp/alternatives/config';
import {
    OfframpTransactionRecord,
    OfframpTransactionRecordSchema,
} from '@/app/FiatRamp/fiatRampSchema';
import { generateOfframpToBankRecipientReceipt } from '@/app/receipts/generators';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { dbClient } from '@/db/dbClient';
import { prettifyNumber } from '@/resources/utils/currency';
import userServiceV2 from '@/runtime/user';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';

export type ManualOfframpSettlement = Omit<OfframpTransactionRecord, 'createdAt' | 'status'>;

class ManualOfframpSettlementService {
    public static async createManualOfframpSettlement(offrampTransaction: ManualOfframpSettlement) {
        return await dbClient.manual_offramp_settlement_transaction.create({
            localAmount: offrampTransaction.localAmount,
            usdAmount: offrampTransaction.usdAmount,
            transactionFeeUsd: offrampTransaction.transactionFeeUsd,
            conversionRate: offrampTransaction.rate,
            paymentCurrency: offrampTransaction.localCurrencySymbol,
            transactionHash: offrampTransaction.transactionHash,
            processingStatus: 'pending',
            ownerId: offrampTransaction.ownerId,
            sequenceId: offrampTransaction.sequenceId,
            blockchainNetwork: offrampTransaction.blockchainNetwork,
            fromWalletAddress: offrampTransaction.fromWalletAddress,
            platformFeePercentage: offrampTransaction.platformFeePercentage,
            hotWalletAddress: offrampTransaction.hotWalletAddress,
            destinationAccountName: offrampTransaction.destination.accountName,
            destinationAccountNumber: offrampTransaction.destination.accountNumber,
            destinationNetworkName: offrampTransaction.destination.networkName,
            tokenAddress: offrampTransaction.tokenAddress,
            tokenSymbol: offrampTransaction.tokenSymbol,
            localCurrencySymbol: offrampTransaction.localCurrencySymbol,
            country: offrampTransaction.destination.country,
        });
    }

    public static async getManualOfframpSettlementBySequenceId(sequenceId: string) {
        return await dbClient.manual_offramp_settlement_transaction
            .filter({
                sequenceId,
            })
            .getFirst();
    }

    public static generateSequenceId(txHash: string) {
        const txHashSha256 = crypto.createHash('sha256').update(txHash).digest('hex');
        const relevantParts = txHashSha256.slice(0, 16) + txHashSha256.slice(-8);
        return `azza-mp-${relevantParts}`;
    }

    public static async sendManualSettleMessages(
        businessPhoneNumberId: string,
        manualOfframpSettlement: ManualOfframpSettlement
    ) {
        const { destination, localCurrencySymbol, localAmount, sequenceId } =
            manualOfframpSettlement;

        const messageBodyText = [
            `*Transaction details*\n`,
            `${localCurrencySymbol} Amount: ${localAmount}`,
            `Account Number: ${destination.accountNumber}`,
            `AccountName: ${destination.accountName}`,
            `Bank: ${destination.networkName}`,
        ].join('\n');

        const messages = MANUAL_OFFRAMP_SETTLERS.map((settler) =>
            MessageGenerators.generateInteractiveButtonMessage({
                bodyText: messageBodyText,
                headerText: `🔔New pending manual offramp settlement`,
                replyButtons: [
                    {
                        title: 'Acknowledge',
                        id: this.getAcknowledgeSettlementInteractiveButtonId(sequenceId),
                    },
                    {
                        title: 'Mark as Paid',
                        id: this.getMarkAsPaidInteractiveButtonId(sequenceId),
                    },
                ],
                recipient: settler,
            })
        );

        const messagePromises = messages.map((message) =>
            WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, message)
        );

        await Promise.all(messagePromises);
    }

    public static async acknowledgeManualSettlement(params: {
        businessPhoneNumberId: string;
        sequenceId: string;
        acknowledger: string;
    }) {
        const settlement = await this.getManualOfframpSettlementBySequenceId(params.sequenceId);
        if (!settlement) throw new Error('Transaction not found');

        if (settlement.processingStatus !== 'pending') {
            await WhatsAppBotService.sendWhatsappMessage(
                params.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.acknowledger,
                    `Transaction already acknowledged.`
                )
            );
            return;
        }

        const user = await userServiceV2.getUserById(settlement.ownerId!);

        if (!user) throw new Error('User not found');

        const userPhoneNumber = user.primaryWhatsappPhoneNumber;
        const totalAmount = prettifyNumber(
            settlement.usdAmount! + settlement.transactionFeeUsd!,
            3
        );

        const transactionDetailsString = `💲Sell ${totalAmount} ${settlement.tokenSymbol} on ${settlement.blockchainNetwork} for ${settlement.localCurrencySymbol} ${prettifyNumber(settlement.localAmount!)}`;

        const message = `⏳ Your transaction with the following details is being processed:\n\n${transactionDetailsString}\n\nPlease be patient`;

        await settlement.update({
            processingStatus: 'processing',
        });

        await WhatsAppBotService.sendWhatsappMessage(
            params.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(userPhoneNumber, message)
        );

        await WhatsAppBotService.sendWhatsappMessage(
            params.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.acknowledger,
                `✅Transaction acknowledged.`
            )
        );
    }

    public static async markManualSettlementAsPaid(params: {
        businessPhoneNumberId: string;
        sequenceId: string;
        settledBy: string;
    }) {
        if (!MANUAL_OFFRAMP_SETTLERS.includes(params.settledBy)) {
            throw new Error(`Unauthorized usage from ${params.settledBy}`);
        }

        const settlement = await this.getManualOfframpSettlementBySequenceId(params.sequenceId);
        if (!settlement) throw new Error('Transaction not found');

        if (settlement.processingStatus === 'complete') {
            await WhatsAppBotService.sendWhatsappMessage(
                params.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.settledBy,
                    `Transaction already marked as complete by +${settlement.settledBy}`
                )
            );
            return;
        }

        const user = await userServiceV2.getUserById(settlement.ownerId!);

        if (!user) throw new Error('User not found');

        const userPhoneNumber = user.primaryWhatsappPhoneNumber;
        const totalAmount = prettifyNumber(
            settlement.usdAmount! + settlement.transactionFeeUsd!,
            3
        );

        await settlement.update({
            settledBy: params.settledBy,
            processingStatus: 'complete',
        });

        const transactionDetailsString = `💲Sell ${totalAmount} ${settlement.tokenSymbol} on ${settlement.blockchainNetwork} for ${settlement.localCurrencySymbol} ${prettifyNumber(settlement.localAmount!)}`;

        const message = `✅ Your transaction with the following details has been completed:\n\n${transactionDetailsString}\n\nExpect your funds within 10 minutes`;

        await WhatsAppBotService.sendWhatsappMessage(
            params.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(userPhoneNumber, message)
        );

        const receiptBuffer = await generateOfframpToBankRecipientReceipt(
            OfframpTransactionRecordSchema.parse({
                ...settlement,
                destination: {
                    accountName: settlement.destinationAccountName,
                    accountNumber: settlement.destinationAccountNumber,
                    networkName: settlement.destinationNetworkName,
                    country: settlement.country,
                    networkId: '', // Not needed here
                    accountType: 'bank',
                },
                createdAt: settlement.xata.createdAt.toISOString(),
                status: 'complete',
                rate: settlement.conversionRate!,
            })
        );
        const uploadedMedia = await WhatsAppBotService.uploadImageToWhatsapp(
            params.businessPhoneNumberId,
            new File([Buffer.from(receiptBuffer)], `receipt-${settlement.sequenceId}.png`, {
                type: 'image/png',
            })
        );

        if (uploadedMedia) {
            await WhatsAppBotService.sendMediaMessage(
                {
                    userPhoneNumber,
                    businessPhoneNumberId: params.businessPhoneNumberId,
                },
                {
                    mediaId: uploadedMedia.id,
                    caption: `🧾Transaction Receipt`,
                    type: 'image',
                }
            );
        }

        await WhatsAppBotService.sendWhatsappMessage(
            params.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.settledBy,
                `✅ Transaction marked as complete.`
            )
        );
    }

    private static getAcknowledgeSettlementInteractiveButtonId(sequenceId: string) {
        return `${ACKNOWLEDGE_BUTTON_ID_PREFIX}${sequenceId}`;
    }

    private static getMarkAsPaidInteractiveButtonId(sequenceId: string) {
        return `${MARK_AS_PAID_BUTTON_ID_PREFIX}${sequenceId}`;
    }
}

export default ManualOfframpSettlementService;
