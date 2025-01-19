export class BlockradarWalletProviderError extends Error {
    public data: unknown;

    constructor(params: { message: string; data: unknown }) {
        super(params.message);
        this.data = params.data;
        this.name = 'BlockradarWalletProviderError';
    }
}
