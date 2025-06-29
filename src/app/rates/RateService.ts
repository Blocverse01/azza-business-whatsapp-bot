import { AzzaRateSource, RateOverride } from "./sources/azza-rate-source";
import { YellowCardRateSource } from "./sources/yellowcard-rate-source";

export interface IRateSource {
    getRates(targetCurrencies?: string[]): Promise<Array<{
        buy: number;
        sell: number;
        code: string;
        locale: string;
    }>>;

    getCurrencyRates(currencySymbol: string): Promise<{
        buy: number;
        sell: number;
        code: string;
        locale: string;
    }>;
}

export class CompositeRateService {
    private externalSource: IRateSource;
    private internalSource: typeof AzzaRateSource;

    constructor() {
        this.externalSource = new YellowCardRateSource();
        this.internalSource = AzzaRateSource;
    }

    /**
     * Get rates with internal overrides applied
     */
    public async getRates(targetCurrencies?: string[]) {
        // Get rates from external source
        const externalRates = await this.externalSource.getRates(targetCurrencies);

        // Get active overrides
        const overrides = await this.internalSource.getRateOverrides(
            targetCurrencies || externalRates.map(r => r.code)
        );

        // Apply overrides
        return this.applyOverrides(externalRates, overrides);
    }

    /**
     * Get single currency rate with overrides
     */
    public async getCurrencyRates(currencySymbol: string) {
        const rates = await this.getRates([currencySymbol]);
        const rate = rates.find(r => r.code === currencySymbol);

        if (!rate) {
            throw new Error(`Rate not found for currency: ${currencySymbol}`);
        }

        return rate;
    }

    /**
     * Apply internal overrides to external rates
     */
    private applyOverrides(
        externalRates: Array<{ buy: number; sell: number; code: string; locale: string }>,
        overrides: RateOverride[]
    ) {
        return externalRates.map(rate => {
            const override = overrides.find(o => o.currencyCode === rate.code);

            if (!override) {
                return rate;
            }

            return {
                ...rate,
                buy: override.buyRate ?? rate.buy,
                sell: override.sellRate ?? rate.sell,
                // Add metadata to indicate override is applied
                _isOverridden: true,
                displayCurrencyCodeAs: override.displayCurrencyCodeAs
            };
        });
    }
}