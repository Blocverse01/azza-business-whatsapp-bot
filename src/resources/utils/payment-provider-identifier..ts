import { BELL_OFFRAMP_PAYMENT_PROCESSOR_ID, HONEYCOIN_OFFRAMP_PAYMENT_PROCESSOR_ID, MANUAL_OFFRAMP_PAYMENT_PROCESSOR_ID, SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID } from "@/app/FiatRamp/config";

export const identifyPaymentProvider = (input: string): string => {

    if (input.includes(BELL_OFFRAMP_PAYMENT_PROCESSOR_ID)) return 'bell';

    if (input.includes(SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID)) return 'safehaven';

    if (input.includes(MANUAL_OFFRAMP_PAYMENT_PROCESSOR_ID)) return 'mp';

    if (input.includes(HONEYCOIN_OFFRAMP_PAYMENT_PROCESSOR_ID)) return 'honeyCoin'

    return 'yellowcard';
}

