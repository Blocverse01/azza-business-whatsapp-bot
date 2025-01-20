import { AssetTransaction } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import { AllSupportedBlockchains } from '@/app/AzzaWalletManager/providers/blockradar/resources/master-wallet-clients';
import { CryptoPayoutOrderStatus } from '@/app/CryptoPayout/cryptoPayoutSchema';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import { GetTransactionReceiptInBackgroundParams } from '@/app/CryptoPayout/getTransactionReceiptInBackground';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import { ZERO } from '@/constants/numbers';
import { CryptoPayoutOrder } from '@/db/xata';
import logger, { logSync } from '@/resources/logger';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import { decimalToString } from '@/resources/utils/currency';
import { AssetConfig } from '@/resources/web3/tokens';
import platformWalletManager from '@/runtime/platform-wallets';
import { spawn } from 'child_process';

type CryptoOrderInput = {
    recipient: string;
    amount: string;
    orderId: string;
};

type CryptoPayoutType = 'offramp-refund' | 'onramp-payment';

export type CryptoPendingOrderGroup = {
    tokenAddress: string;
    network: AllSupportedBlockchains;
    orders: Array<CryptoOrderInput>;
    payoutType: CryptoPayoutType;
};

type ProcessCryptoPayoutGroupResponse = {
    submittedOrders: Array<TransferCryptoForIndividualOrderResponse>;
    unSubmittedOrders: CryptoPendingOrderGroup['orders'];
};
type TransferCryptoForIndividualOrderResponse = {
    transactionResponse: AssetTransaction;
    order: CryptoOrderInput;
};

class CryptoPayoutCronJobService {
    public static async execute() {
        const validPendingCryptoPayoutOrders =
            await CryptoPayoutService.getValidPendingCryptoPayoutOrders();

        console.log(validPendingCryptoPayoutOrders);

        const groupedOrders = this.groupCryptoOrdersByTokenAndNetwork(
            validPendingCryptoPayoutOrders
        );

        console.log(groupedOrders);

        const promises = groupedOrders.map((group) => {
            return this.processCryptoPayoutGroup(group);
        });

        const processingResults = await Promise.allSettled(promises);

        const successfulResults = processingResults.filter(
            (result) => result.status === 'fulfilled'
        ) as Array<PromiseFulfilledResult<ProcessCryptoPayoutGroupResponse | undefined>>;
        const failedResults = processingResults.filter(
            (result) => result.status === 'rejected'
        ) as Array<PromiseRejectedResult>;

        const successfulGroupOrders = successfulResults.map((result) => result.value);

        const allUnsubmittedOrderIds: string[][] = [];

        successfulGroupOrders.filter(Boolean).forEach((group) => {
            if (group) {
                group.submittedOrders.forEach((order) => {
                    this.getTransactionReceiptInBackground(
                        order.order.orderId,
                        order.transactionResponse.id,
                        order.transactionResponse.asset
                    );
                });

                const unSubmittedOrderIds = group.unSubmittedOrders.map((order) => order.orderId);
                allUnsubmittedOrderIds.push(unSubmittedOrderIds);
            }
        });

        if (allUnsubmittedOrderIds.flat().length > 0) {
            await CryptoPayoutService.updateCryptoPayoutOrdersStatus(
                allUnsubmittedOrderIds.flat(),
                CryptoPayoutOrderStatus.PENDING
            );
        }

        if (failedResults.length > 0) {
            console.dir(failedResults, { depth: Infinity });
        }
    }

    private static getTransactionReceiptInBackground(
        orderId: string,
        transactionId: string,
        asset: AssetConfig
    ) {
        const serializedParams = JSON.stringify({
            orderId: orderId,
            transactionId,
            asset,
        } satisfies GetTransactionReceiptInBackgroundParams);

        // Spawn the background process
        const backgroundProcess = spawn(
            'tsx',
            ['src/app/CryptoPayout/getTransactionReceiptInBackground.ts', serializedParams],
            {
                stdio: 'inherit', // Optional: Inherit stdio to see logs in the parent process console
            }
        );

        backgroundProcess.on('spawn', () => {
            logSync('debug', `Began background process to get transaction receipt`, {
                orderId,
                transactionId,
            });
        });

        backgroundProcess.on('error', (err) => {
            logSync('debug', 'Failed to start background process:', err);
        });
    }

    private static async processCryptoPayoutGroup(
        group: CryptoPendingOrderGroup
    ): Promise<ProcessCryptoPayoutGroupResponse | undefined> {
        const platformAddressUserId =
            group.payoutType === 'onramp-payment' ? 'onramp-payout' : 'offramp-hot-wallet';

        const asset = platformWalletManager.searchAssets({
            network: group.network,
            tokenAddress: group.tokenAddress,
        })[ZERO];

        if (!asset) {
            throw new Error(
                `Asset not found for token address ${group.tokenAddress} on network ${group.network}`
            );
        }

        console.log({
            asset,
            platformAddressUserId,
        });

        let tokenBalanceNumber = (
            await platformWalletManager.getAssetBalance({
                userId: platformAddressUserId,
                assetId: asset.listItemId,
            })
        ).balance;

        console.log(`Got token balance: ${tokenBalanceNumber}`);

        const processableOrdersInGroup: CryptoPendingOrderGroup['orders'] = [];
        const unProcessableOrdersInGroup: CryptoPendingOrderGroup['orders'] = [];

        group.orders.forEach((order) => {
            if (tokenBalanceNumber >= Number(order.amount)) {
                processableOrdersInGroup.push(order);
                tokenBalanceNumber -= Number(order.amount);
            } else {
                unProcessableOrdersInGroup.push(order);
            }
        });

        console.dir(
            {
                processableOrdersInGroup,
                unProcessableOrdersInGroup,
            },
            {
                depth: Infinity,
            }
        );

        if (unProcessableOrdersInGroup.length > 0) {
            await this.handleUnprocessableOrdersInGroup(
                unProcessableOrdersInGroup,
                group,
                tokenBalanceNumber
            );
        }

        if (processableOrdersInGroup.length > 0) {
            try {
                await CryptoPayoutService.updateCryptoPayoutOrdersStatus(
                    processableOrdersInGroup.map((order) => order.orderId),
                    CryptoPayoutOrderStatus.PROCESSING
                );

                const individualTransferPromises = processableOrdersInGroup.map((order) => {
                    return this.transferCryptoForIndividualOrder(order, {
                        network: group.network,
                        tokenAddress: group.tokenAddress,
                        payoutAddressUserId: platformAddressUserId,
                        assetId: asset.listItemId,
                    });
                });

                const results = await Promise.allSettled(individualTransferPromises);

                const successfulResults = results.filter(
                    (result) => result.status === 'fulfilled'
                ) as Array<PromiseFulfilledResult<TransferCryptoForIndividualOrderResponse>>;

                const submittedTransactionResponses = successfulResults.map(
                    (result) => result.value
                );

                const unSubmittedOrders = processableOrdersInGroup.filter((order) => {
                    return !submittedTransactionResponses.find(
                        (response) => response.order.orderId === order.orderId
                    );
                });

                return {
                    submittedOrders: submittedTransactionResponses,
                    unSubmittedOrders,
                };
            } catch (error) {
                await logServiceError(error, 'Failed to process crypto payout group');

                await CryptoPayoutService.updateCryptoPayoutOrdersStatus(
                    processableOrdersInGroup.map((order) => order.orderId),
                    CryptoPayoutOrderStatus.PENDING
                );
            }
        }
    }

    private static async transferCryptoForIndividualOrder(
        order: {
            recipient: string;
            amount: string;
            orderId: string;
        },
        config: {
            tokenAddress: string;
            network: SupportedChain | ExtendedWalletSupportedNetworks;
            payoutAddressUserId: string;
            assetId: string;
        }
    ) {
        const transactionResponse = await platformWalletManager.withdrawAsset({
            amount: order.amount,
            assetId: config.assetId,
            recipient: order.recipient,
            userId: config.payoutAddressUserId,
        });

        return {
            transactionResponse,
            order,
        };
    }

    private static async handleUnprocessableOrdersInGroup(
        orders: CryptoPendingOrderGroup['orders'],
        group: CryptoPendingOrderGroup,
        walletBalance: number
    ) {
        void logger.info(`Failed to process ${orders.length} payout orders`, {
            group,
            orders,
            walletBalance,
        });
    }

    public static groupCryptoOrdersByTokenAndNetwork(pendingOrders: Array<CryptoPayoutOrder>) {
        const groupedOrders: Array<CryptoPendingOrderGroup> = [];

        pendingOrders.forEach((order) => {
            const assetConfig = platformWalletManager.searchAssets({
                tokenName: order.tokenSymbol,
                network: order.network as AllSupportedBlockchains,
            })[ZERO];

            if (!assetConfig) {
                return;
            }

            const existingGroup = groupedOrders.find(
                (group) =>
                    group.tokenAddress === assetConfig.tokenAddress &&
                    group.network === assetConfig.network &&
                    group.payoutType === order.payoutType
            );

            if (existingGroup) {
                existingGroup.orders.push({
                    recipient: order.destinationWalletAddress,
                    amount: decimalToString(order.amount),
                    orderId: order.id,
                });
            } else {
                groupedOrders.push({
                    tokenAddress: assetConfig.tokenAddress,
                    network: assetConfig.network,
                    orders: [
                        {
                            recipient: order.destinationWalletAddress,
                            amount: decimalToString(order.amount),
                            orderId: order.id,
                        },
                    ],
                    payoutType: order.payoutType as CryptoPayoutType,
                });
            }
        });

        return groupedOrders;
    }
}

export default CryptoPayoutCronJobService;
