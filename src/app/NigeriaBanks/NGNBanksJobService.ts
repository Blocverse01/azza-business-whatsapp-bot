import logger from '@/resources/logger';
import { HttpException } from '@/resources/exceptions/HttpException';
import { INTERNAL_SERVER_ERROR } from '@/constants/status-codes';
import { addNgnBankTransactionUpdateJobToQueue } from './queue-utils';
import NigeriaBanksService from './NigeriaBanksService';
import { ProcessorId } from '../FiatRamp/config';
import { validProcessors } from './NigeriaBanksSchema';

class NGNBankJobService {
    public static async execute() {
        try {
            const settlements = await NigeriaBanksService.getNGNBankOfframpProcessingTransactions();

            void logger.info(`Updating ${settlements.length} NGN bank off-ramp transactions`);

            if (settlements.length === 0) {
                void logger.info(`No NGN bank off-ramp settlements found...`);
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

                await addNgnBankTransactionUpdateJobToQueue({
                    transactionId: settlement.sequenceId,
                    processorName: settlement.processorName,
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

export default NGNBankJobService;
