import { OfframpTransactionRecord } from "../FiatRamp/fiatRampSchema";


export type NGNoffRampSettlement = Omit<OfframpTransactionRecord, 'createdAt' | 'status'>;
