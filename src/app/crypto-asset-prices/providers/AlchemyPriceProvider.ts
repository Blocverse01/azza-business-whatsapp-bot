import { AssetConfig } from '@/resources/web3/core/tokens';
import { CryptoAssetPriceProvider } from '../CryptoAssetPriceProvider';
import { GetAssetPriceResponse, SupportedFiat } from '../types';
import { CryptoAssetPriceProviderError } from './errors';

type AlchemyPriceProviderResponse = {
    data: Array<{
        symbol: string;
        prices: Array<{
            currency: string;
            value: string;
        }>;
    }>;
};

class AlchemyPriceProvider implements CryptoAssetPriceProvider {
    private readonly alchemyApiKey: string;
    private readonly alchemyApiUrl: string = 'https://api.g.alchemy.com/prices/v1';

    constructor(alchemyApiKey: string) {
        this.alchemyApiKey = alchemyApiKey;
    }

    public async getAssetPrice(asset: AssetConfig): Promise<GetAssetPriceResponse> {
        const requestUrl = `${this.alchemyApiUrl}/${this.alchemyApiKey}/tokens/by-symbol/${asset.tokenName}`;

        const response = await fetch(requestUrl);

        const data = await response.text();

        if (!response.ok) {
            throw new CryptoAssetPriceProviderError({
                message: `Failed to fetch price for ${asset.tokenName} from Alchemy. Status: ${response.status}`,
                data: {
                    status: response.status,
                    statusText: response.statusText,
                    url: requestUrl,
                    response: data,
                },
            });
        }

        try {
            const parsedData = JSON.parse(data) as AlchemyPriceProviderResponse;

            const prices: GetAssetPriceResponse = {
                USD: 0,
            };

            const targetAsset = parsedData.data.find(
                (item) => item.symbol.toUpperCase() === asset.tokenName.toUpperCase()
            );
            if (!targetAsset) {
                throw new CryptoAssetPriceProviderError({
                    message: `Failed to find asset ${asset.tokenName} in Alchemy response`,
                    data: parsedData,
                });
            }

            targetAsset.prices.forEach((price) => {
                const currency = price.currency as SupportedFiat;
                prices[currency] = parseFloat(price.value);
            });

            return prices;
        } catch (error) {
            throw new CryptoAssetPriceProviderError({
                message: `Failed to parse response from Alchemy for ${asset.tokenName}. Error: ${error}`,
                data: error,
            });
        }
    }
}

export { AlchemyPriceProvider };
