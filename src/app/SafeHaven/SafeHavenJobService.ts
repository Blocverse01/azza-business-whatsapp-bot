import logger from "@/resources/logger";
import SafeHavenService from "./SafeHavenService";
import { prettifyNumber } from "@/resources/utils/currency";
import userServiceV2 from "@/runtime/user";
import env from "@/constants/env";
import { addCashbackJobToQueue } from "../campaigns/base-cashbacks/utils";
import azzaWalletManager from "@/runtime/wallet";
import { generateOfframpToBankRecipientReceipt } from "../receipts/generators";
import { addCryptoPayoutJobToQueue } from "../crypto-payouts-v2/utils";
import { HttpException } from "@/resources/exceptions/HttpException";
import { INTERNAL_SERVER_ERROR } from "@/constants/status-codes";
import { transactionStatusSchema } from "../FiatRamp/fiatRampSchema";
import { Buffer } from 'node:buffer';
import WhatsAppBotService from "../WhatsAppBot/WhatsAppBotService";
import { addSafeHavenTransactionUpdateJobToQueue } from "./queue-utils";


class SafeHavenJobService {

    public static async execute() {

        try {
            const settlements = await SafeHavenService.getSafeHavenOfframpPendingTransactions();

            void logger.info(`Updating  ${settlements.length} safehaven off-ramp transactions`);

            if (settlements.length === 0) {
                void logger.info(`No safehaven off-ramp settlements found...`);
            }

            settlements.map(async (settlement) => {
                await addSafeHavenTransactionUpdateJobToQueue({ transactionId: settlement.sequenceId as string });
            })

        } catch (error) {
            throw new HttpException(INTERNAL_SERVER_ERROR, 'Error getting safehaven off-ramp settlements')
        }
    }

}

export default SafeHavenJobService;


