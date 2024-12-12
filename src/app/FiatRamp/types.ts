export interface YellowCardWebhookPayload {
    id: string;
    sequenceId: string;
    status: string;
    apiKey: string;
    event: string;
}

export enum YellowCardOfframpEvent {
    paymentComplete = 'PAYMENT.COMPLETE',
    paymentProcessing = 'PAYMENT.PROCESSING',
    paymentPending = 'PAYMENT.PENDING',
    paymentFailed = 'PAYMENT.FAILED',
    paymentCancelled = 'PAYMENT.CANCELLED',
}

export const YellowCardOfframpEvents = Object.values(YellowCardOfframpEvent);

export enum YellowCardOnRampEvent {
    collectionComplete = 'COLLECTION.COMPLETE',
    collectionProcessing = 'COLLECTION.PROCESSING',
    collectionPending = 'COLLECTION.PENDING',
    collectionFailed = 'COLLECTION.FAILED',
    collectionCancelled = 'COLLECTION.CANCELLED',
}
export const YellowCardOnRampEvents = Object.values(YellowCardOnRampEvent);
