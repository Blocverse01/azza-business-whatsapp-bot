import { ProcessorId } from "../FiatRamp/config";
import { OfframpTransactionRecord } from "../FiatRamp/fiatRampSchema";


export type NGNoffRampSettlement = Omit<OfframpTransactionRecord, 'createdAt' | 'status'>;

export const validProcessors: ProcessorId[] = ['bell', 'safehaven'];