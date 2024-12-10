import { getQuoteRequestParamsSchema } from '@/app/LiFi/app.lifi.schema';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { createConfig, getActiveRoute, getQuote, QuoteRequest } from '@lifi/sdk';

createConfig({
    integrator: 'azza-bot-service',
});

export type ChainsSupportedByLifi = Exclude<SupportedChain, 'Lisk'>;

const chainsSupportedByLifi: ChainsSupportedByLifi[] = [
    'Solana',
    'Optimism',
    'Ethereum',
    'Polygon',
    'Base',
];

class LiFiIntegrationLibrary {
    public static async getQuote(params: QuoteRequest) {
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
                Base: 'BASE',
            } satisfies Record<ChainsSupportedByLifi, string>
        )[platformChain];
    }

    public static isSupportedChain(chain: SupportedChain): chain is ChainsSupportedByLifi {
        return chainsSupportedByLifi.includes(chain as ChainsSupportedByLifi);
    }
}

export default LiFiIntegrationLibrary;
