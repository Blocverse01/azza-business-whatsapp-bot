import logger from "@/resources/logger";
import SafeHavenService from "./SafeHavenService";
import { HttpException } from "@/resources/exceptions/HttpException";
import { INTERNAL_SERVER_ERROR } from "@/constants/status-codes";
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


