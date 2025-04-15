import { AssetConfig } from '@/resources/web3/core/tokens';
import { CryptoAssetPriceProvider } from './CryptoAssetPriceProvider';
import { SupportedFiat } from './types';

class CryptoAssetPriceService {
    private readonly priceProvider: CryptoAssetPriceProvider;

    constructor(priceProvider: CryptoAssetPriceProvider) {
        this.priceProvider = priceProvider;
    }

    public async getAssetPrice(asset: AssetConfig, currency: SupportedFiat): Promise<number> {
        const prices = await this.priceProvider.getAssetPrice(asset);
        return prices[currency];
    }
}

export { CryptoAssetPriceService };
