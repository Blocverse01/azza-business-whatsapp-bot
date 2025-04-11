import { CryptoAssetPriceService } from '@/app/crypto-asset-prices/CryptoAssetPriceService';
import { AlchemyPriceProvider } from '@/app/crypto-asset-prices/providers/AlchemyPriceProvider';

const defaultPriceProvider = new AlchemyPriceProvider('');

const cryptoAssetPriceService = new CryptoAssetPriceService(defaultPriceProvider);
export default cryptoAssetPriceService;
