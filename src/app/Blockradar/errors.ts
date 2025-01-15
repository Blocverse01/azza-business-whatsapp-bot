export class BlockradarMasterWalletApiClientError extends Error {
    public requestUrl: string;
    public statusCode: number;
    public rawJsonResponse: unknown;

    constructor(params: {
        message: string;
        requestUrl: string;
        statusCode: number;
        rawJsonResponse: unknown;
    }) {
        super(params.message);
        this.requestUrl = params.requestUrl;
        this.statusCode = params.statusCode;
        this.rawJsonResponse = params.rawJsonResponse;
        this.name = 'BlockradarMasterWalletApiClientError';
    }
}
