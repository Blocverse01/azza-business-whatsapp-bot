import { dbClient } from "@/db/dbClient";
import { P2pAgentAccountBalance, P2pAgentAccountBalanceSchema, P2pAgentTransactionParams } from "./P2pAgentSchema";
import { transactionStatusSchema } from "@/app/FiatRamp/fiatRampSchema";
import { decryptWithAES, encryptWithAES } from "@/resources/utils/encryption";
import env from "@/constants/env";
import { SIX } from "@/constants/numbers";
import { INTERNAL_SERVER_ERROR } from "@/constants/status-codes";
import { HttpException } from "@/resources/exceptions/HttpException";
import WhatsAppBotService from "@/app/WhatsAppBot/WhatsAppBotService";
import MessageGenerators from "@/app/WhatsAppBot/MessageGenerators";

class P2pAgentService {
    private static readonly P2P_AGENT_TRANSACTION_REPOSITORY = dbClient.p2p_agent_transactions;
    private static readonly P2P_AGENT_PERCENTAGE = dbClient.p2p_agent_percentage;
    private static readonly P2P_AGENT_ACCOUNT_BALANCE = dbClient.p2p_agent_account_balance;


    public static async createP2pAgentTransaction(transaction: P2pAgentTransactionParams) {
        return await this.P2P_AGENT_TRANSACTION_REPOSITORY.create({
            localAmount: transaction.localAmount,
            usdAmount: transaction.usdAmount,
            localCurrencySymbol: transaction.localCurrencySymbol,
            processingStatus: transaction.processingStatus,
            ownerId: transaction.ownerId,
            blockchainNetwork: transaction.blockchainNetwork,
            tokenSymbol: transaction.tokenSymbol,
            country: transaction.country,
            transactionType: transaction.transactionType,
            sequenceId: transaction.sequenceId,
            rewardAmount: transaction.rewardAmount,
            rewardPercentage: transaction.rewardPercentage,
            providerName: transaction.providerName
        });
    }

    public static async getP2pAgentTransactionBySequenceId(sequenceId: string) {
        return await this.P2P_AGENT_TRANSACTION_REPOSITORY.filter({
            sequenceId
        }).getFirst();
    }

    public static async getP2pAgentCommissionPercentage() {
        const record = await this.P2P_AGENT_PERCENTAGE.getFirst();
        return record
    }

    public static async updateP2pAgentAccountBalance(agentId: string, amount: number) {

        const p2pAgent = await this.P2P_AGENT_ACCOUNT_BALANCE.filter({ p2pAgentId: agentId }).getFirst();

        let currentAccountBalance = '0.00'

        if (p2pAgent && p2pAgent.accountBalance) {

            currentAccountBalance = (await this.validateP2pAgentAccountBalancePayload(p2pAgent?.accountBalance)).currentBalance;

            const newAccountBalance = (Number(currentAccountBalance) + amount).toFixed(SIX);

            const maskedAccountBalance = await this.generateEncryptedP2pAgentAccountBalance({ previousBalance: currentAccountBalance, currentBalance: newAccountBalance });

            const isUpdated = await p2pAgent.update({
                accountBalance: maskedAccountBalance
            });

            if (!isUpdated) {
                throw new HttpException(INTERNAL_SERVER_ERROR, `Failed to update p2p agent account balance`);
            }

            return isUpdated;

        } else {
            return this.createP2pAgentWallet(amount, currentAccountBalance, agentId)
        }

    }


    private static async createP2pAgentWallet(amount: number, currentAccountBalance: string, agentId: string) {

        const newAccountBalance = Number(amount).toFixed(SIX);

        const maskedAccountBalance = await this.generateEncryptedP2pAgentAccountBalance(
            {
                previousBalance: currentAccountBalance,
                currentBalance: newAccountBalance
            });

        const isCreated = await this.P2P_AGENT_ACCOUNT_BALANCE.create({
            accountBalance: maskedAccountBalance,
            p2pAgentId: agentId
        });

        if (!isCreated) {
            throw new HttpException(INTERNAL_SERVER_ERROR, `Failed to create p2p agent account`);
        }

        return isCreated
    }


    private static async generateEncryptedP2pAgentAccountBalance(params: P2pAgentAccountBalance) {
        const accountBalance = encryptWithAES(
            JSON.stringify(params),
            env.P2P_AGENT_ACCOUNT_BALANCE_MASK_KEY,
            env.P2P_AGENT_ACCOUNT_BALANCE_MASK_IV
        );
        return accountBalance;
    }


    private static async validateP2pAgentAccountBalancePayload(params: string) {
        const decryptedPayload = decryptWithAES(
            params,
            env.P2P_AGENT_ACCOUNT_BALANCE_MASK_KEY,
            env.P2P_AGENT_ACCOUNT_BALANCE_MASK_IV
        );

        return P2pAgentAccountBalanceSchema.parse(JSON.parse(decryptedPayload));
    }


    public static async sendNotAuthorizedAsAgentMessage(phoneParams: { businessPhoneNumberId: string, userPhoneNumber: string }) {

        const message = `You're not authorized to perform this action. Please contact our support team for assistance.`

        await WhatsAppBotService.sendWhatsappMessage(
            phoneParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                phoneParams.userPhoneNumber,
                message
            )
        );
    }

    public static async getP2pAgentAccountSummary(
        userId: string,
        phoneParams: {
            businessPhoneNumberId: string,
            userPhoneNumber: string
        }) {

        await WhatsAppBotService.sendWhatsappMessage(
            phoneParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                phoneParams.userPhoneNumber,
                `\n Hang tight — your account statement will be ready shortly 📄.`
            )
        );

        const [transactions, p2pAgentAccount] = await Promise.all([
            dbClient.p2p_agent_transactions
                .filter({ ownerId: userId })
                .getAll(),
            dbClient.p2p_agent_account_balance
                .filter({ p2pAgentId: userId, })
                .getFirst(),
        ]);


        const safeTransactions = transactions ?? [];

        const totalVolume = safeTransactions.reduce(
            (sum, txn) => sum + (txn?.usdAmount || 0),
            0
        );

        const totalEarnings = safeTransactions.reduce(
            (sum, txn) => sum + (txn?.rewardAmount || 0),
            0
        );

        const currentAccountBalance = p2pAgentAccount ? (await this.validateP2pAgentAccountBalancePayload(
            p2pAgentAccount?.accountBalance!
        )).currentBalance : '0.00';

        const message = `*We're pleased to share your current performance*: \n\nTotal Transaction Volume:  $${totalVolume} \n\nTotal Earnings:  $${totalEarnings} \n\nRedeemable balance:  $${Number(currentAccountBalance)}\n\n`;

        await WhatsAppBotService.sendWhatsappMessage(
            phoneParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                phoneParams.userPhoneNumber,
                message
            )
        );
    }

}


export default P2pAgentService;