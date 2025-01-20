import { AssetTransferRecipientType } from '@/app/azza/azza.schema';
import { AllSupportedBlockchains } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import UserService from '@/app/User/UserService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { queues } from '@/background-processing/queues';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import {
    QueueNames,
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult,
} from '@/background-processing/types';
import { ENABLED_ASSETS } from '@/config/whatsAppBot';
import { UserRecord } from '@/db/xata';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
} from '@/resources/utils/encryption';
import { capitalize } from '@/resources/utils/transformers';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { Worker } from 'bullmq';

const walletMigrationWorker = new Worker<
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult
>(
    QueueNames.walletMigration,
    async (job) => {
        const oldUserId = job.data.oldUserId
            ? convertBase64ToAsciiString(job.data.oldUserId)
            : undefined;
        const userPhoneNumber = convertBase64ToAsciiString(job.data.userPhoneNumber);
        const businessPhoneNumberId = convertBase64ToAsciiString(job.data.businessPhoneNumberId);
        let oldUser: UserRecord | null = null;

        if (oldUserId) {
            oldUser = await UserService.getUserByPhoneNumber(oldUserId);
        }

        const newUser =
            (await userServiceV2.getWhatsappUserByPhoneNumber(userPhoneNumber)) ??
            (await userServiceV2.createWhatsappUser(
                userPhoneNumber,
                oldUser
                    ? {
                          transactionPinHash: oldUser.transactionPinHash,
                          securityQuestionsSetup: oldUser.securityQuestionsSetup,
                          firstName: oldUser.firstName,
                          lastName: oldUser.lastName,
                          kycStatus: oldUser.kycStatus,
                          kycDateOfBirth: oldUser.kycDateOfBirth,
                          kycIdType: oldUser.kycIdType,
                          kycDocumentNumber: oldUser.kycDocumentNumber,
                          additionalKycIdType: oldUser.additionalKycIdType ?? null,
                          additionalKycIdNumber: oldUser.additionalKycIdNumber,
                          country: oldUser.country,
                      }
                    : undefined
            ));

        if (oldUser) {
            await UserService.updateMigratedAt(oldUser, new Date());
        }

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

            if (oldUserId) {
                const oldUserFirstName = oldUser?.firstName ?? null;
                const userTag = oldUserFirstName
                    ? capitalize(oldUserFirstName.split(' ')[0])
                    : 'there';

                await WhatsAppBotService.sendWhatsappMessage(
                    businessPhoneNumberId,
                    MessageGenerators.generateTextMessage(
                        userPhoneNumber,
                        `Hey ${userTag},\n\nI’ve got some exciting news – I now support BSC, Solana, and Tron chains! 🥳\n\nAs part of this update, all your wallet addresses have been upgraded.\n\n👉 Important: Please request your wallet address to view your new wallet details before making any deposits.\n\nEnjoy seamless transactions across multiple chains! 🚀`
                    )
                );
            }
        }

        if (oldUserId) {
            const networksToMigrate: AllSupportedBlockchains[] = [
                'Base',
                'Optimism',
                'Ethereum',
                'Polygon',
            ];

            const supportedAssetIds = ENABLED_ASSETS.filter((asset) =>
                networksToMigrate.includes(asset.network)
            ).map((asset) => asset.listItemId);
            const promises = supportedAssetIds.map((assetId) =>
                UserService.getUserAssetInfo(oldUserId, assetId)
            );
            const userAssets = await Promise.all(promises);

            const addCryptoDebitPromises = userAssets.map((asset) => {
                const targetWallet = newWallets.find(
                    (wallet) => wallet.blockchainNetwork === asset.assetNetwork
                )?.address;

                if (asset && asset.tokenBalance > 0 && targetWallet) {
                    return queues.cryptoDebit.add('user-funds-migration', {
                        userId: convertAsciiStringToBase64(oldUserId),
                        transactionType: 'SEND',
                        assetId: asset.listItemId,
                        amount: asset.tokenBalance,
                        recipient: targetWallet,
                        recipientType: AssetTransferRecipientType.WALLET_ADDRESS,
                        transactionFee: 0,
                        transactionPin: '',
                    });
                }
            });

            await Promise.all(addCryptoDebitPromises);
        }

        return {
            newUserId,
            walletIds: newWallets.map((wallet) => wallet.id),
        };
    },
    {
        connection: connectionConfig,
        concurrency: 1,
    }
);

// Wallet Migration Worker
walletMigrationWorker.on('completed', async (job) => {
    console.log('Wallet Migration Worker completed', job.returnvalue);
});
walletMigrationWorker.on('failed', async (job, error) => {
    console.log(`Wallet Migration Worker failed`, error);
});
