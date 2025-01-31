export class BlockradarMasterWalletApiClientError extends Error {
    public requestUrl: string;
    public statusCode: number;
    public rawJsonResponse: unknown;
    public requestData: unknown;

    constructor(params: {
        message: string;
        requestUrl: string;
        statusCode: number;
        rawJsonResponse: unknown;
        requestData?: unknown;
    }) {
        super(params.message);
        this.requestUrl = params.requestUrl;
        this.statusCode = params.statusCode;
        this.rawJsonResponse = params.rawJsonResponse;
        this.requestData = params.requestData;
        this.name = 'BlockradarMasterWalletApiClientError';
    }
}
