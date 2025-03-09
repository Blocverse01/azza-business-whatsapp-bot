import { UserWallet } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import { getMasterWalletClient } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import { BlockradarAddress } from '@/app/Blockradar/schema';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import {
    QueueNames,
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult,
} from '@/background-processing/types';
import { syncUserAddressJob } from '@/background-processing/utils';
import { convertBase64ToAsciiString } from '@/resources/utils/encryption';
import {
    AllSupportedBlockchains,
    isEvmCompatibleBlockchain,
} from '@/resources/web3/core/blockchains';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { Worker } from 'bullmq';

type NetworkType = 'EVM' | 'SOLANA' | 'TRON';

const searchAddressForNetwork = async (network: AllSupportedBlockchains, userId: string) => {
    const walletClient = getMasterWalletClient(network);
    const wallet = await walletClient.searchAddressByMetadata({
        userId,
    });
    if (!wallet) return null;

    return {
        networkType: isEvmCompatibleBlockchain(network)
            ? 'EVM'
            : (network.toUpperCase() as NetworkType),
        wallet,
    };
};

const walletMigrationWorker = new Worker<
    UserWalletMigrationQueueInput,
    UserWalletMigrationQueueResult
>(
    QueueNames.walletMigration,
    async (job) => {
        const userPhoneNumber = convertBase64ToAsciiString(job.data.userPhoneNumber);

        const expectedWalletTypes: NetworkType[] = ['EVM', 'SOLANA', 'TRON'] as const;

        const newUser =
            (await userServiceV2.getWhatsappUserByPhoneNumber(userPhoneNumber)) ??
            (await userServiceV2.createWhatsappUser(userPhoneNumber));

        const newUserId = newUser.id;

        // Wallets have been created
        const existingWalletConfig = await userServiceV2.getUserBlockradarWallets(newUserId);
        const existingTargetWallets = existingWalletConfig
            ? expectedWalletTypes
                  .map((walletType) => {
                      return existingWalletConfig.find(
                          (config) =>
                              config.blockchainNetwork.toUpperCase() === walletType.toUpperCase()
                      );
                  })
                  .filter((item) => item !== undefined)
            : [];

        if (expectedWalletTypes.length === existingTargetWallets.length) {
            return {
                newUserId,
                walletIds: existingTargetWallets.map((wallet) => wallet.addressId),
            };
        }

        const existingTargetWalletTypes = existingTargetWallets
            .map((item) => item?.blockchainNetwork)
            .filter(Boolean);

        // Some Wallets are missing
        const walletsToCreate = expectedWalletTypes.filter(
            (walletType) => !existingTargetWalletTypes.includes(walletType)
        );

        const evmNetworks = azzaWalletManager
            .getSupportedNetworks()
            .filter((network) => isEvmCompatibleBlockchain(network));

        const networksToCreateFor: Array<AllSupportedBlockchains> = [];

        if (walletsToCreate.includes('EVM')) {
            networksToCreateFor.push(...evmNetworks);
        }
        if (walletsToCreate.includes('SOLANA')) {
            networksToCreateFor.push('Solana');
        }
        if (walletsToCreate.includes('TRON')) {
            networksToCreateFor.push('Tron');
        }

        const searchedWalletPromises: Partial<
            Record<
                NetworkType,
                Promise<{
                    networkType: NetworkType;
                    wallet: BlockradarAddress;
                } | null>
            >
        > = {};

        networksToCreateFor.forEach((network) => {
            const promise = new Promise<{
                networkType: NetworkType;
                wallet: BlockradarAddress;
            } | null>((resolve) => {
                return resolve(searchAddressForNetwork(network, newUserId));
            });

            if (isEvmCompatibleBlockchain(network) && !searchedWalletPromises['EVM']) {
                searchedWalletPromises['EVM'] = promise;
            }
            if (network === 'Solana' && !searchedWalletPromises['SOLANA']) {
                searchedWalletPromises['SOLANA'] = promise;
            }
            if (network === 'Tron' && !searchedWalletPromises['TRON']) {
                searchedWalletPromises['TRON'] = promise;
            }
        });

        const searchedWallets = (await Promise.all(Object.values(searchedWalletPromises))).filter(
            (item) => item !== null
        );

        const networksToCreateForFiltered = networksToCreateFor.filter((network) => {
            const networkType = isEvmCompatibleBlockchain(network) ? 'EVM' : network.toUpperCase();
            return (
                searchedWallets.find((searched) => searched.networkType === networkType) ===
                undefined
            );
        });

        const newWallets: UserWallet[] = [];

        if (networksToCreateForFiltered.length > 0) {
            newWallets.push(
                ...(await azzaWalletManager.createUserWallets({
                    userId: newUserId,
                    networks: networksToCreateForFiltered,
                    shouldMapEvmAddresses: true,
                }))
            );
        }

        if (searchedWallets.length > 0) {
            searchedWallets.forEach((searchedWallet) => {
                if (searchedWallet.networkType === 'EVM' && searchedWallet.wallet !== null) {
                    newWallets.push(
                        ...evmNetworks.map((evm) => ({
                            address: searchedWallet.wallet.address,
                            blockchainNetwork: evm,
                            userId: newUserId,
                            id: searchedWallet.wallet.id,
                            name: searchedWallet.wallet.name,
                        }))
                    );
                }
                if (searchedWallet.networkType === 'SOLANA' && searchedWallet.wallet) {
                    newWallets.push({
                        address: searchedWallet.wallet.address,
                        blockchainNetwork: 'Solana',
                        userId: newUserId,
                        id: searchedWallet.wallet.id,
                        name: searchedWallet.wallet.name,
                    });
                }
                if (searchedWallet.networkType === 'TRON' && searchedWallet.wallet) {
                    newWallets.push({
                        address: searchedWallet.wallet.address,
                        blockchainNetwork: 'Tron',
                        userId: newUserId,
                        id: searchedWallet.wallet.id,
                        name: searchedWallet.wallet.name,
                    });
                }
            });
        }

        if (newWallets.length === 0) {
            throw new Error('No wallets were created for the user');
        }

        const syncWalletsQueue = newWallets.map((newWallet) =>
            syncUserAddressJob({
                userId: newUserId,
                network: newWallet.blockchainNetwork,
                address: newWallet.address,
                addressId: newWallet.id,
            })
        );

        await Promise.all(syncWalletsQueue);

        return {
            newUserId,
            walletIds: newWallets.map((wallet) => wallet.id),
        };
    },
    {
        connection: connectionConfig,
        concurrency: 1,
        limiter: {
            max: 1,
            duration: 180_000,
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
