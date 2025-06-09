import { queues } from "@/background-processing/queues";
import { connectionConfig } from "@/background-processing/redis-connection-config";
import { GenerateAccountStatementQueueInput, QueueNames } from "@/background-processing/types";
import { Worker } from 'bullmq';
import WhatsAppBotService from "../WhatsAppBot/WhatsAppBotService";
import MessageGenerators from "../WhatsAppBot/MessageGenerators";
import { generateAccountStatementPdf } from "./account-statement-generator";
import { XataClient } from '@/db/db-client-2';
import { dbClient } from '@/db/dbClient';
import env from "@/constants/env";
import { RawTransaction, TransactionsSummary, TransactionType, TransformedTransaction } from "./types";
import { formatDate } from "date-fns";
import { UserV2Record } from "@/db/xata";

const xataClient2 = new XataClient({
    apiKey: env.XATA_API_KEY,
    branch: env.XATA_BRANCH,
});


export const addJobToAccountStatementQueue = async (data: GenerateAccountStatementQueueInput) => {
    return await queues.generateAccountStatement.add(`user-account-statement-${data.user.id}`, data, {
        removeOnComplete: {
            age: 24 * 7 * 3600, // keep up to 7 days
            count: 1000, // keep up to 1000 jobs
        },
        removeOnFail: {
            age: 24 * 3 * 3600, // keep up to 3 days
        },
    });
};

export const createAccountStatementWorker = () => {
    return new Worker<GenerateAccountStatementQueueInput>(
        QueueNames.generateAccountStatement,
        async (job) => {
            return await handleAccountStatementJob(job.data);
        },
        {
            connection: connectionConfig,
            concurrency: 20,
        }
    );
};


const handleAccountStatementJob = async (data: GenerateAccountStatementQueueInput) => {
    const {
        whatsappParams: { businessPhoneNumberId, userPhoneNumber },
        startDate,
        endDate,
        user
    } = data;


    await WhatsAppBotService.sendWhatsappMessage(
        businessPhoneNumberId,
        MessageGenerators.generateTextMessage(
            userPhoneNumber,
            `\n Hang tight — your account statement will be ready shortly 📄.`
        )
    );

    const pdfBuffer = await generateAccountStatementPdf({
        startDate,
        endDate,
        user
    });

    if (!pdfBuffer) return;

    // Format date as YYYY-MM-DD
    const date = new Date().toISOString().slice(0, 10);

    const fileName = `Statement_${'azza'}_${date}.pdf`;

    const pdfFile = new File([pdfBuffer], fileName, { type: 'application/pdf' });

    const mediaResponse = await WhatsAppBotService.uploadPDFToWhatsapp(
        businessPhoneNumberId,
        pdfFile
    );

    if (!mediaResponse?.id) {
        return;
    }

    await WhatsAppBotService.sendPDFMessage(
        { userPhoneNumber, businessPhoneNumberId },
        {
            mediaId: mediaResponse.id,
            caption: `\n Click the document to download your account statement. \n`,
            type: 'document',
            filename: fileName
        }
    );
}


export async function getAllUserTransactionsByDateRange(params: {
    startDate: string,
    endDate: string,
    user: UserV2Record
}): Promise<TransactionsSummary> {

    const { startDate, endDate, user } = params;

    const userId = user.id;

    const _startDate = new Date(startDate);
    const _endDate = new Date(endDate);

    const [ycOfframp, ycOnramp, manualOfframp, ngnBanksOfframp, honeycoinOfframp] = await Promise.all([
        xataClient2.db.yellowcard_offramp_transaction
            .select(['*', 'beneficiary.*'])
            .filter({
                yellowCardStatus: { $iContains: 'complete' },
                ownerId: userId
            })
            .getAll(),
        xataClient2.db.yellowcard_onramp_transaction
            .filter({ yellowCardStatus: { $iContains: 'complete' }, ownerId: userId, })
            .getAll(),
        dbClient.manual_offramp_settlement_transaction
            .filter({ processingStatus: { $iContains: 'complete' }, ownerId: userId, })
            .getAll(),
        dbClient.ngn_banks_offramp_settlement_transaction
            .filter({ processingStatus: { $iContains: 'complete' }, ownerId: userId })
            .getAll(),
        dbClient.honeycoin_offramp_settlement_transaction
            .filter({ processingStatus: { $iContains: 'complete' }, ownerId: userId, })
            .getAll(),
    ]);

    const allTransactions = [
        ...ycOfframp.map(tx => transformTransaction(tx, 'offramp')),
        ...ycOnramp.map(tx => transformTransaction(tx, 'onramp')),
        ...manualOfframp.map(tx => transformTransaction(tx, 'offramp')),
        ...ngnBanksOfframp.map(tx => transformTransaction(tx, 'offramp')),
        ...honeycoinOfframp.map(tx => transformTransaction(tx, 'offramp'))
    ];

    const filteredTxs = filterTransactionsByDateRange(allTransactions, _startDate, _endDate);

    const totalTrades = filteredTxs.length;

    if (totalTrades === 0) {
        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            MessageGenerators.generateTextMessage(
                user.primaryWhatsappPhoneNumber,
                `\n  Hey! It looks like you don’t have any transactions in this period.Try expanding the date range or check back later! 😊`
            )
        );

        return {
            transactions: [],
            user: {
                totalTrades: 0,
                totalVolumeUsd: 0,
                address: "",
                phoneNumber: "",
                fullName: ""
            }
        };
    }

    const totalVolumeUsd = filteredTxs.reduce((sum, tx) => {
        const [usd] = tx.amount.split(' ');
        return sum + parseFloat(usd);
    }, 0);

    return {
        transactions: filteredTxs,
        user: {
            address: capitalizeWords(user.address as string),
            phoneNumber: user.primaryWhatsappPhoneNumber,
            fullName: `${capitalizeWords(user.firstName as string)} ${capitalizeWords(user.lastName as string)}`,
            totalTrades,
            totalVolumeUsd: parseFloat(totalVolumeUsd.toFixed(2))
        }
    };
}

function transformTransaction(tx: RawTransaction, type: TransactionType): TransformedTransaction {
    const isBuy = type === 'onramp';

    const recipient = isBuy
        ? {
            type: 'Wallet' as const,
            walletAddress: tx.destinationWalletAddress ?? 'N/A',
        }
        : {
            type: 'Bank' as const,
            accountNumber:
                tx.beneficiary?.accountNumber ??
                tx.collectionAccountNumber ??
                tx.destinationAccountNumber ??
                'N/A',
            accountName:
                tx.beneficiary?.accountName ??
                tx.collectionAccountName ??
                tx.destinationAccountName ??
                'N/A',
            bankName:
                (tx.beneficiary?.networkName ??
                    tx.collectionBankName ??
                    tx.destinationNetworkName ??
                    'N/A').toLowerCase(),
        };

    return {
        date: tx.xata?.createdAt
            ? formatDate(tx.xata.createdAt, 'LLL, dd y')
            : 'N/A',
        time: tx.xata?.createdAt
            ? formatDate(tx.xata.createdAt, 'HH:mm a')
            : 'N/A',
        type: isBuy ? 'Buy' : 'Sell',
        amount: `${(tx.usdAmount ?? 0).toFixed(2)} ${tx.tokenSymbol ?? 'N/A'}`,
        chain: (tx.blockchainNetwork ?? 'UNKNOWN').toUpperCase(),
        token: tx.tokenSymbol as string,
        recipient,
        reference: String(tx.sequenceId || tx.referenceId || 'N/A')
    };
}


export function capitalizeWords(value: string) {
    if (!value) return '';
    return value
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function filterTransactionsByDateRange(
    transactions: TransformedTransaction[],
    startDate: Date,
    endDate: Date
): TransformedTransaction[] {
    const start = startDate.getTime();
    const end = endDate.getTime();

    return transactions.filter(tx => {
        const txDate = new Date(tx.date).getTime();
        return txDate >= start && txDate <= end;
    });
}

