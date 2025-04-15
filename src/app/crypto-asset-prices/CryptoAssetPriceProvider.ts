import { AssetConfig } from '@/resources/web3/core/tokens';
import { GetAssetPriceResponse } from './types';

export abstract class CryptoAssetPriceProvider {
    public abstract getAssetPrice(asset: AssetConfig): Promise<GetAssetPriceResponse>;
}
