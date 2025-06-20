const STABLES_FIAT_EQUIVALENT: Record<string, string> = {
    USDT: 'USD',
    USDC: 'USD',
    CNGN: 'NGN',
};

export const isPeggedCurrency = (tokenSymbol: string, fiatCurrencySymbol: string) => {
    return STABLES_FIAT_EQUIVALENT[tokenSymbol.toUpperCase()] === fiatCurrencySymbol.toUpperCase();
};

export const getTokenToCurrencyConversionRate = (
    tokenSymbol: string,
    fiatCurrencySymbol: string,
    usdToFiatConversionRate: number
) => {
    if (isPeggedCurrency(tokenSymbol, fiatCurrencySymbol)) {
        return 1; // Pegged stablecoins have a conversion rate of 1 to their fiat equivalent
    }

    if (tokenSymbol.toUpperCase().startsWith('USD')) {
        return usdToFiatConversionRate;
    }

    throw new Error('Unsupported token symbol for conversion rate calculation');
};
