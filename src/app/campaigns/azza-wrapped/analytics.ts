import { RankCardGeneratorParams } from '@/app/campaigns/azza-wrapped/types';
import env from '@/constants/env';
import { XataClient } from '@/db/db-client-2';
import { dbClient } from '@/db/dbClient';

type UserTransaction = {
    usdAmount: number;
    blockchainNetwork: string;
    ownerId: string;
};

const xataClient2 = new XataClient({
    apiKey: env.XATA_API_KEY,
    branch: env.XATA_BRANCH,
});

const RANK_THRESHOLDS: Record<RankCardGeneratorParams['rank'], [number, number]> = {
    hustler: [0, 99],
    azzaman: [100, 499],
    odogwu: [500, 999],
    jagaban: [1000, Infinity],
};

function generateUserTransactionStats(transactions: Array<UserTransaction>) {
    let totalVolume = 0;
    let highestTrade = 0;
    let transactionCountByBlockchain: Record<string, number> = {};

    for (const tx of transactions) {
        totalVolume += tx.usdAmount;
        if (tx.usdAmount > highestTrade) {
            highestTrade = tx.usdAmount;
        }

        const network = tx.blockchainNetwork;
        transactionCountByBlockchain[network] = (transactionCountByBlockchain[network] || 0) + 1;
    }

    const numberOfTransactions = transactions.length;

    const frequentChain = Object.entries(transactionCountByBlockchain).reduce(
        (mostUsed, [network, count]) =>
            count > transactionCountByBlockchain[mostUsed] ? network : mostUsed,
        Object.keys(transactionCountByBlockchain)[0] || ''
    );

    return {
        totalVolume,
        highestTrade,
        numberOfTransactions,
        frequentChain,
    };
}

async function getAllUserTransactions(userId: string): Promise<Array<UserTransaction>> {
    const [ycOfframpTxs, ycOnrampTxs, manualOfframpTxs, safeHavenOfframpTxs] = await Promise.all([
        xataClient2.db.yellowcard_offramp_transaction
            .filter({
                yellowCardStatus: {
                    $iContains: 'complete',
                },
                ownerId: userId,
            })
            .getAll(),
        xataClient2.db.yellowcard_onramp_transaction
            .filter({
                yellowCardStatus: {
                    $iContains: 'complete',
                },
                ownerId: userId,
            })
            .getAll(),
        dbClient.manual_offramp_settlement_transaction
            .filter({
                processingStatus: {
                    $iContains: 'complete',
                },
                ownerId: userId,
            })
            .getAll(),
        dbClient.safehaven_offramp_settlement_transaction
            .filter({
                processingStatus: {
                    $iContains: 'complete',
                },
                ownerId: userId,
            })
            .getAll(),
    ]);

    return [ycOfframpTxs, ycOnrampTxs, manualOfframpTxs, safeHavenOfframpTxs].flat().map((tx) => ({
        usdAmount: tx.usdAmount ?? 0,
        blockchainNetwork: tx.blockchainNetwork!,
        ownerId: tx.ownerId!,
    }));
}

function getUserLevelRank(userVolume: number): 'hustler' | 'azzaman' | 'odogwu' | 'jagaban' {
    if (userVolume <= RANK_THRESHOLDS.hustler[1]) {
        return 'hustler';
    }
    if (userVolume <= RANK_THRESHOLDS.azzaman[1]) {
        return 'azzaman';
    }
    if (userVolume <= RANK_THRESHOLDS.odogwu[1]) {
        return 'odogwu';
    }
    return 'jagaban';
}

const formatNumber = (value: number, style: 'decimal' | 'currency'): string =>
    new Intl.NumberFormat('en-US', {
        style: style,
        currency: 'USD',
        notation: 'compact',
    }).format(value);

export async function getUserStatsAndRank(userId: string): Promise<{
    rank: RankCardGeneratorParams['rank'];
    stats: RankCardGeneratorParams['stats'];
}> {
    const userTransactions = await getAllUserTransactions(userId);

    const userTotal = userTransactions.reduce((sum, tx) => sum + tx.usdAmount, 0);

    const rank = getUserLevelRank(userTotal);
    const stats = generateUserTransactionStats(userTransactions);

    const formattedStats: RankCardGeneratorParams['stats'] = {
        totalVolume: formatNumber(stats.totalVolume, 'currency'),
        highestTrade: formatNumber(stats.highestTrade, 'currency'),
        numberOfTransactions: formatNumber(stats.numberOfTransactions, 'decimal'),
        frequentChain: stats.frequentChain,
    };

    return { rank, stats: formattedStats };
}
