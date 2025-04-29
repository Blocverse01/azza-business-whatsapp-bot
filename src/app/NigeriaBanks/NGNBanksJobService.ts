import logger from '@/resources/logger';
import SafeHavenService from './SafeHaven/SafeHavenService';
import { HttpException } from '@/resources/exceptions/HttpException';
import { INTERNAL_SERVER_ERROR } from '@/constants/status-codes';
import { addSafeHavenTransactionUpdateJobToQueue } from './queue-utils';
import NigeriaBanksService from './NigeriaBanksService';

class SafeHavenJobService {
    public static async execute() {
        try {
            const settlements = await NigeriaBanksService.getNGNBankOfframpProcessingTransactions();

            void logger.info(`Updating ${settlements.length} NGN bank off-ramp transactions`);

            if (settlements.length === 0) {
                void logger.info(`No NGN bank off-ramp settlements found...`);
            }

            settlements.map(async (settlement) => {
                await addSafeHavenTransactionUpdateJobToQueue({
                    transactionId: settlement.sequenceId as string,
                    processorName: settlement.processorName as string
                });
            });
        } catch (error) {
            throw new HttpException(
                INTERNAL_SERVER_ERROR,
                'Error getting safehaven off-ramp settlements'
            );
        }
    }
}

export default SafeHavenJobService;
