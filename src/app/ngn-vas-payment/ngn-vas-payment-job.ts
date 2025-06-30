import logger from '@/resources/logger';
import { HttpException } from '@/resources/exceptions/HttpException';
import { INTERNAL_SERVER_ERROR } from '@/constants/status-codes';
import { addNgnVasTransactionUpdateJobToQueue } from './queue-utils';
import { ProcessorId } from '../FiatRamp/config';
import { validProcessors } from '../NigeriaBanks/NigeriaBanksSchema';
import SafeHavenService from '../NigeriaBanks/SafeHaven/SafeHavenService';

class NGNVasJobService {
    public static async execute() {
        try {
            const settlements = await SafeHavenService.getNGNVasProcessingTransactions();

            void logger.info(`Updating ${settlements.length} NGN Vas transactions`);

            if (settlements.length === 0) {
                void logger.info(`No NGN Vas transactions found...`);
            }

            settlements.map(async (settlement) => {
                if (!settlement.processorName) {
                    logger.warn(
                        `Missing processorName for transaction, sequenceId :  ${settlement.sequenceId}`
                    );
                    return;
                }

                if (!validProcessors.includes(settlement.processorName as ProcessorId)) {
                    logger.warn(
                        `Invalid processorName for transaction, sequenceId: ${settlement.sequenceId}`
                    );
                    return;
                }

                await addNgnVasTransactionUpdateJobToQueue({
                    transactionId: settlement.sequenceId!,
                    processorName: settlement.processorName,
                });
            });
        } catch (error) {
            throw new HttpException(
                INTERNAL_SERVER_ERROR,
                'Error getting safehaven vas payment settlements'
            );
        }
    }
}

export default NGNVasJobService;
