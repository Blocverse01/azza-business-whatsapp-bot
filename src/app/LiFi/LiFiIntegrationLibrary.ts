import { getQuoteRequestParamsSchema } from '@/app/LiFi/app.lifi.schema';
import { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import { createConfig, getActiveRoute, getQuote, QuoteRequest } from '@lifi/sdk';

export type ChainsSupportedByLifi = Exclude<
    AllSupportedBlockchains,
    'Lisk' | 'AssetChain' | 'Tron' | 'Bep20' | 'Arbitrum'
>;

export const chainsSupportedByLifi: ChainsSupportedByLifi[] = [
    'Solana',
    'Optimism',
    'Ethereum',
    'Polygon',
    'Base',
];

class LiFiIntegrationLibrary {
    private static initialized = false;

    private static initialize() {
        if (this.initialized) {
            return;
        }

        createConfig({
            integrator: 'azza-bot-service',
        });

        this.initialized = true;
    }

    public static async getQuote(params: QuoteRequest) {
        this.initialize();

        const validParams = getQuoteRequestParamsSchema.parse(params);

        return await getQuote(validParams);
    }

    public static getActiveQuote(routeId: string) {
        return getActiveRoute(routeId);
    }

    public static getChainKey(platformChain: ChainsSupportedByLifi): string {
        return (
            {
                Solana: 'SOL',
                Optimism: 'OPT',
                Ethereum: 'ETH',
                Polygon: 'POL',
                Base: 'BAS',
            } satisfies Record<ChainsSupportedByLifi, string>
        )[platformChain];
    }

    public static isSupportedChain(chain: AllSupportedBlockchains): chain is ChainsSupportedByLifi {
        return chainsSupportedByLifi.includes(chain as ChainsSupportedByLifi);
    }
}

export default LiFiIntegrationLibrary;
