import { CryptoAssetPriceProvider } from './CryptoAssetPriceProvider';
import { SupportedFiat } from './types';

class CryptoAssetPriceService {
    private readonly priceProvider: CryptoAssetPriceProvider;

    constructor(priceProvider: CryptoAssetPriceProvider) {
        this.priceProvider = priceProvider;
    }

    public async getAssetPrice(assetSymbol: string, currency: SupportedFiat): Promise<number> {
        const prices = await this.priceProvider.getAssetPrice(assetSymbol);
        return prices[currency];
    }
}

export { CryptoAssetPriceService };
