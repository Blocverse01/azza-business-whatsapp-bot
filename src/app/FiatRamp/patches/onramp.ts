import { Effect, Schema } from 'effect';
import { XataClient } from '@/db/db-client-2';
import { OnrampTransactionRecord, onrampTransactionRecordSchema } from '../fiatRampSchema';
import { z } from 'zod';
import { ConfigError } from 'effect/ConfigError';
import FiatRampService from '../FiatRampService';

const xataApiKey = Schema.Config('XATA_API_KEY', Schema.String.pipe(Schema.minLength(4)));
const xataBranch = Schema.Config('XATA_BRANCH', Schema.String.pipe(Schema.minLength(1)));

// Create a service for the Xata client
const makeXataClient = Effect.gen(function* () {
    const apiKey = yield* xataApiKey;
    const branch = yield* xataBranch;

    return new XataClient({
        apiKey,
        branch,
    });
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
): Effect.Effect<OnrampPatchUpdateResponse, Error | ConfigError> => {
    return Effect.gen(function* () {
        const xataClient2 = yield* makeXataClient;

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
): Effect.Effect<OnrampTransactionRecord, Error | ConfigError> => {
    return Effect.gen(function* () {
        const xataClient2 = yield* makeXataClient;

        // Get the record by sequenceId
        const record = yield* Effect.tryPromise({
            try: () =>
                xataClient2.db.yellowcard_onramp_transaction
                    .filter({ sequenceId })
                    .select(['*', 'collectionCountry.*'])
                    .getFirst(),
            catch: (error) => new Error(`Failed to fetch onramp transaction: ${error}`),
        });
        const recordFromProvider = yield* Effect.tryPromise({
            try: () => FiatRampService.getOnrampTransaction(sequenceId),
            catch: (error) => new Error(`Failed to fetch onramp transaction: ${error}`),
        });

        // Check if record exists
        if (!record || !recordFromProvider) {
            return yield* Effect.fail(
                new Error(`Onramp transaction not found for sequenceId: ${sequenceId}`)
            );
        }

        return {
            ...recordFromProvider,
            tokenAmount: record.tokenAmount,
            transactionFeeInToken: record.transactionFeeInToken,
        };
    });
};
