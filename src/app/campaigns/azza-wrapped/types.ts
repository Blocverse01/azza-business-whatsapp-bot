export type RankCardGeneratorParams = {
    stats: {
        totalVolume: string;
        highestTrade: string;
        numberOfTransactions: string;
        frequentChain: string;
    };
    rank: 'odogwu' | 'azzaman' | 'jagaban' | 'hustler';
    displayName: string;
};
