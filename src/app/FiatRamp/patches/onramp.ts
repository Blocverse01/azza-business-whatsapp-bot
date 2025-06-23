import { Effect } from 'effect';
import env from '@/constants/env';
import { XataClient } from '@/db/db-client-2';
import { OnrampTransactionRecord, onrampTransactionRecordSchema } from '../fiatRampSchema';
import { z } from 'zod';

const xataClient2 = new XataClient({
    apiKey: env.XATA_API_KEY,
    branch: env.XATA_BRANCH,
});

type OnrampDataPatches = {
    tokenAmount: number;
    transactionFeeInToken: number;
};
type OnrampPatchUpdateResponse = {
    id: string;
    sequenceId: string;
    updatedAt: Date;
};

export const updateOnrampTxWithPatches = (
    sequenceId: string,
    patches: OnrampDataPatches
): Effect.Effect<OnrampPatchUpdateResponse, Error> => {
    return Effect.gen(function* () {
        // Get existing record
        const existingRecord = yield* Effect.tryPromise({
            try: () =>
                xataClient2.db.yellowcard_onramp_transaction.filter({ sequenceId }).getFirst(),
            catch: (error) => new Error(`Failed to fetch record: ${error}`),
        });

        // Check if record exists
        if (!existingRecord) {
            return yield* Effect.fail(new Error('Onramp Transaction not found'));
        }

        // Update the record
        const updatedRecord = yield* Effect.tryPromise({
            try: () => existingRecord.update(patches),
            catch: (error) => new Error(`Failed to update record: ${error}`),
        });

        // Check if update was successful
        if (!updatedRecord) {
            return yield* Effect.fail(new Error('Failed to update record'));
        }

        return {
            id: updatedRecord.id,
            sequenceId: updatedRecord.sequenceId,
            updatedAt: updatedRecord.xata_updatedat,
        };
    });
};

export const getPatchedOnrampTxBySequenceId = (
    sequenceId: string
): Effect.Effect<OnrampTransactionRecord, Error> => {
    return Effect.gen(function* () {
        // Get the record by sequenceId
        const record = yield* Effect.tryPromise({
            try: () =>
                xataClient2.db.yellowcard_onramp_transaction.filter({ sequenceId }).getFirst(),
            catch: (error) => new Error(`Failed to fetch onramp transaction: ${error}`),
        });

        // Check if record exists
        if (!record) {
            return yield* Effect.fail(
                new Error(`Onramp transaction not found for sequenceId: ${sequenceId}`)
            );
        }

        // Validate the record against the schema
        const validationResult = yield* Effect.try({
            try: () => onrampTransactionRecordSchema.parse(record),
            catch: (error) =>
                new Error(
                    `Schema validation failed: ${error instanceof z.ZodError ? error.message : error}`
                ),
        });

        return validationResult;
    });
};
