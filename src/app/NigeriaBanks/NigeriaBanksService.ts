import { dbClient } from "@/db/dbClient";
import { transactionStatusSchema } from "../FiatRamp/fiatRampSchema";
import { NGNoffRampSettlement } from "./NigeriaBanksSchema";
import { prettifyNumber } from "@/resources/utils/currency";
import userServiceV2 from "@/runtime/user";
import WhatsAppBotService from "../WhatsAppBot/WhatsAppBotService";


class NigeriaBanksService {

    private static readonly NGN_OFFRAMP_TRANSACTION_REPOSITORY =
        dbClient.safehaven_offramp_settlement_transaction;

    public static async createNGNOfframpSettlement(
        offrampTransaction: NGNoffRampSettlement
    ) {
        return await this.NGN_OFFRAMP_TRANSACTION_REPOSITORY.create({
            localAmount: offrampTransaction.localAmount,
            usdAmount: offrampTransaction.usdAmount,
            transactionFeeUsd: offrampTransaction.transactionFeeUsd,
            conversionRate: offrampTransaction.rate,
            paymentCurrency: offrampTransaction.localCurrencySymbol,
            transactionHash: offrampTransaction.transactionHash,
            processingStatus: transactionStatusSchema.parse('pending'),
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
            processorName: offrampTransaction.destination.processorName
        });
    }

    public static async sendProcessingSettlementMessage(params: {
        usdAmount: number;
        transactionFeeUsd: number;
        ownerId: string;
        tokenSymbol: string;
        blockchainNetwork: string;
        localCurrencySymbol: string;
        localAmount: number;
    }) {
        const {
            usdAmount,
            transactionFeeUsd,
            localAmount,
            ownerId,
            tokenSymbol,
            blockchainNetwork,
            localCurrencySymbol,
        } = params;

        const totalAmount = prettifyNumber(usdAmount + transactionFeeUsd);

        const userPhoneNumber = await userServiceV2.getUserPhoneNumber(ownerId);

        const transactionDetailsString = `💲Sell ${totalAmount} ${tokenSymbol} on ${blockchainNetwork} for ${localCurrencySymbol} ${prettifyNumber(localAmount)}`;

        const message = this.ProcessingTransactionMessage(transactionDetailsString);

        await this.sendArbitraryTextMessage(message, userPhoneNumber);
    }

    public static ProcessingTransactionMessage(transactionDetailsString: string) {
        const message = `⏳ Your transaction with the following details is being processed:\n\n${transactionDetailsString}\n\nPlease be patient`;
        return message;
    }

    public static TransactionCompleteMessage(transactionDetailsString: string) {
        const message = `✅ Your transaction with the following details has been completed:\n\n${transactionDetailsString}\n\nExpect your funds within 1 - 5 minutes`;
        return message;
    }

    public static TransactionFailedMessage(transactionDetailsString: string) {
        const message = `❌ Your transaction with the following details has failed:\n\n${transactionDetailsString}\n\nPlease contact support for assistance`;
        return message;
    }

    public static async sendArbitraryTextMessage(message: string, userPhoneNumber: string) {
        if (message.trim()) {
            try {
                await WhatsAppBotService.sendArbitraryTextMessage(userPhoneNumber, message);
            } catch (error) { }
        }
    }

}


export default NigeriaBanksService;