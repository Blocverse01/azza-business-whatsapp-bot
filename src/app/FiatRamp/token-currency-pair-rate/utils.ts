const STABLES_FIAT_EQUIVALENT: Record<string, string> = {
    USDT: 'USD',
    USDC: 'USD',
    CNGN: 'NGN',
};

export const isPeggedCurrency = (tokenSymbol: string, fiatCurrencySymbol: string) => {
    return STABLES_FIAT_EQUIVALENT[tokenSymbol.toUpperCase()] === fiatCurrencySymbol.toUpperCase();
};

export const getTokenToCurrencyConversionRate = async (
    tokenSymbol: string,
    fiatCurrencySymbol: string,
    usdToFiatConversionRate: number
) => {
    if (isPeggedCurrency(tokenSymbol, fiatCurrencySymbol)) {
        return Promise.resolve(1); // Pegged stablecoins have a conversion rate of 1 to their fiat equivalent
    }

    if (tokenSymbol.toUpperCase().startsWith('USD')) {
        return Promise.resolve(usdToFiatConversionRate);
    }

    throw new Error('Unsupported token symbol for conversion rate calculation');
};
