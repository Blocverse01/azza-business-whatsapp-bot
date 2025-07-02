import FiatRampsRpcService from "@/app/FiatRamp/grpcService/FiatRampsRpcService";
import { IRateSource } from "../RateService";

export class YellowCardRateSource implements IRateSource {
    public async getRates(targetCurrencies?: string[]) {
        return await FiatRampsRpcService.getRates(targetCurrencies);
    }

    public async getCurrencyRates(currencySymbol: string) {
        return await FiatRampsRpcService.getCurrencyRates(currencySymbol);
    }
}