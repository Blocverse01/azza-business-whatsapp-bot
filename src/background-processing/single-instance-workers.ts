import { connectionConfig } from '@/background-processing/redis-connection-config';
import {
    QueueNames,
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult,
} from '@/background-processing/types';
import { convertBase64ToAsciiString } from '@/resources/utils/encryption';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { Worker } from 'bullmq';

const walletMigrationWorker = new Worker<
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult
>(
    QueueNames.walletMigration,
    async (job) => {
        const userPhoneNumber = convertBase64ToAsciiString(job.data.userPhoneNumber);

        const newUser =
            (await userServiceV2.getWhatsappUserByPhoneNumber(userPhoneNumber)) ??
            (await userServiceV2.createWhatsappUser(userPhoneNumber));

        const newUserId = newUser.id;

        const newWallets = await azzaWalletManager.createUserWallets({
            userId: newUserId,
            networks: azzaWalletManager.getSupportedNetworks(),
            shouldMapEvmAddresses: true,
        });

        if (newWallets.length === 0) {
            throw new Error('No wallets were created for the user');
        }

        const existingWalletConfig = await userServiceV2.getUserBlockradarWallets(newUserId);

        if (!existingWalletConfig || existingWalletConfig.length === 0) {
            await userServiceV2.createUserBlockradarWalletConfig(
                newUserId,
                newWallets.map((wallet) => ({
                    blockchainNetwork: wallet.blockchainNetwork,
                    addressId: wallet.id,
                    address: wallet.address,
                }))
            );
        }

        return {
            newUserId,
            walletIds: newWallets.map((wallet) => wallet.id),
        };
    },
    {
        connection: connectionConfig,
        concurrency: 5,
        limiter: {
            max: 5,
            duration: 10000,
        },
    }
);

// Wallet Migration Worker
walletMigrationWorker.on('completed', async (job) => {
    console.log('Wallet Migration Worker completed', job.returnvalue);
});
walletMigrationWorker.on('failed', async (job, error) => {
    console.log(`Wallet Migration Worker failed`, error);
});
