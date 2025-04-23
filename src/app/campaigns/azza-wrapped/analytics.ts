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

async function getAllTransactions(): Promise<Array<UserTransaction>> {
    const [ycOfframpTxs, ycOnrampTxs, manualOfframpTxs, safeHavenOfframpTxs] = await Promise.all([
        xataClient2.db.yellowcard_offramp_transaction
            .filter({
                yellowCardStatus: {
                    $iContains: 'complete',
                },
            })
            .getAll(),
        xataClient2.db.yellowcard_onramp_transaction
            .filter({
                yellowCardStatus: {
                    $iContains: 'complete',
                },
            })
            .getAll(),
        dbClient.manual_offramp_settlement_transaction
            .filter({
                processingStatus: {
                    $iContains: 'complete',
                },
            })
            .getAll(),
        dbClient.safehaven_offramp_settlement_transaction
            .filter({
                processingStatus: {
                    $iContains: 'complete',
                },
            })
            .getAll(),
    ]);

    return [ycOfframpTxs, ycOnrampTxs, manualOfframpTxs, safeHavenOfframpTxs].flat().map((tx) => ({
        usdAmount: tx.usdAmount ?? 0,
        blockchainNetwork: tx.blockchainNetwork!,
        ownerId: tx.ownerId!,
    }));
}

function getAllUserVolumes(allTxs: Array<UserTransaction>): Record<string, number> {
    const volumeMap: Record<string, number> = {};

    for (const tx of allTxs) {
        const ownerId = tx.ownerId;
        const usdAmount = tx.usdAmount ?? 0;
        if (!ownerId) continue;

        volumeMap[ownerId] = (volumeMap[ownerId] || 0) + usdAmount;
    }

    return volumeMap;
}

function getUserLevelRank(
    userVolume: number,
    allUserVolumes: number[]
): 'hustler' | 'azzaman' | 'odogwu' | 'jagaban' {
    const sortedVolumes = [...allUserVolumes].sort((a, b) => a - b);
    const index = sortedVolumes.findIndex((v) => userVolume <= v);
    const position = index === -1 ? sortedVolumes.length : index;
    const percentile = (position / sortedVolumes.length) * 100;

    if (percentile <= 25) return 'hustler';
    if (percentile <= 50) return 'azzaman';
    if (percentile <= 75) return 'odogwu';
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
    const allTransactions = await getAllTransactions();
    const volumeMap = getAllUserVolumes(allTransactions);
    const userTxs = allTransactions.filter((tx) => tx.ownerId === userId);

    const userTotal = userTxs.reduce((sum, tx) => sum + tx.usdAmount, 0);
    const allVolumes = Object.values(volumeMap);

    const rank = getUserLevelRank(userTotal, allVolumes);
    const stats = generateUserTransactionStats(userTxs);

    const formattedStats: RankCardGeneratorParams['stats'] = {
        totalVolume: formatNumber(stats.totalVolume, 'currency'),
        highestTrade: formatNumber(stats.highestTrade, 'currency'),
        numberOfTransactions: formatNumber(stats.numberOfTransactions, 'decimal'),
        frequentChain: stats.frequentChain,
    };

    return { rank, stats: formattedStats };
}
