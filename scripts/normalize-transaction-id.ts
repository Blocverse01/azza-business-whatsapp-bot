import { Repository } from '@xata.io/client';
import { isNumber } from 'mathjs';
import env from '../src/constants/env';
import {
    XataClient,
    YellowcardOfframpTransactionRecord,
    YellowcardOnrampTransactionRecord,
} from '../src/db/db-client-2';
import { dbClient } from '../src/db/dbClient';

// Regular expression to check if the ownerId consists only of digits
const isValidPhoneNumber = (ownerId: any): boolean => /^\d+$/.test(ownerId);

const xataClient2 = new XataClient({
    apiKey: env.XATA_API_KEY,
    branch: env.XATA_BRANCH,
});

async function normalizeTransaction(
    repo:
        | Repository<YellowcardOfframpTransactionRecord>
        | Repository<YellowcardOnrampTransactionRecord>
) {
    const transactions = await repo.getAll();

    // Filter transactions where ownerId is a phone number (stored as a number)
    const txsToNormalize = transactions.filter((tx) => isValidPhoneNumber(tx.ownerId));

    console.log(txsToNormalize.length);

    // Extract the unique phone numbers from transactions and ensure uniqueness
    const uniqueUserPhoneNumbers = Array.from(new Set(txsToNormalize.map((tx) => tx.ownerId)));

    // Fetch users with the given phone numbers (primaryWhatsappPhoneNumber)
    const users = await dbClient.user_v2
        .filter({
            primaryWhatsappPhoneNumber: {
                $any: uniqueUserPhoneNumbers,
            },
        })
        .getAll();

    // Create a mapping of phone numbers to user record IDs
    const phoneToUserIdMap: Record<string, string> = {};
    users.forEach((user) => {
        phoneToUserIdMap[user.primaryWhatsappPhoneNumber] = user.id;
    });

    // Update each transaction's ownerId with the user record ID
    const updatedTxs = txsToNormalize.map((tx) => {
        const userId = phoneToUserIdMap[tx.ownerId];
        if (userId) {
            return {
                id: tx.id,
                ownerId: userId,
            };
        }
        return null; // If no userId is found, return the transaction unchanged
    });

    const filteredTxs = updatedTxs.filter((tx) => tx !== null);
    console.log(txsToNormalize.length, filteredTxs.length);

    return filteredTxs;
}

export async function run() {
    const updatableOfframpTxs = await normalizeTransaction(
        xataClient2.db.yellowcard_offramp_transaction
    );
    const updatableOnrampTxs = await normalizeTransaction(
        xataClient2.db.yellowcard_onramp_transaction
    );

    await xataClient2.db.yellowcard_offramp_transaction.update(updatableOfframpTxs);
    await xataClient2.db.yellowcard_onramp_transaction.update(updatableOnrampTxs);
}

run();
