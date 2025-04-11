import { CryptoAssetPriceService } from '@/app/crypto-asset-prices/CryptoAssetPriceService';
import { AlchemyPriceProvider } from '@/app/crypto-asset-prices/providers/AlchemyPriceProvider';
import env from '@/constants/env';

const defaultPriceProvider = new AlchemyPriceProvider(env.ALCHEMY_API_KEY);

const cryptoAssetPriceService = new CryptoAssetPriceService(defaultPriceProvider);
export default cryptoAssetPriceService;
