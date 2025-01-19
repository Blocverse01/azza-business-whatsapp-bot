import { queues } from '../src/background-processing/queues';
import env from '../src/constants/env';
import { dbClient } from '../src/db/dbClient';
import { convertAsciiStringToBase64 } from '../src/resources/utils/encryption';

async function migrateUsers() {
    const allUsers = await dbClient.User.getAll();

    const addJobPromises = allUsers.map((user) =>
        queues.walletMigration.add(`Migrate user: ${user.id}`, {
            oldUserId: convertAsciiStringToBase64(user.id),
            userPhoneNumber: convertAsciiStringToBase64(user.phoneNumber!),
            businessPhoneNumberId: convertAsciiStringToBase64(env.WA_PHONE_NUMBER_ID),
        })
    );

    await Promise.all(addJobPromises);
}

void migrateUsers();
