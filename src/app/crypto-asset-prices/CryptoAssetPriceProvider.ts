import { GetAssetPriceResponse } from './types';

export abstract class CryptoAssetPriceProvider {
    public abstract getAssetPrice(assetSymbol: string): Promise<GetAssetPriceResponse>;
}
