export class CryptoDebitWorkerError extends Error {
    public data: unknown;

    constructor(message: string, data?: unknown) {
        super(message);
        this.name = 'CryptoDebitWorkerError';
        this.data = data;
    }
}

export class EventDrivenOfframpWorkerError extends Error {
    public data: unknown;

    constructor(message: string, data?: unknown) {
        super(message);
        this.name = 'EventDrivenOfframpWorkerError';
        this.data = data;
    }
}
