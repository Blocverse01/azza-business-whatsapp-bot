import { CryptoPayoutOrderStatus } from '@/app/CryptoPayout/cryptoPayoutSchema';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import { SupportedChain, TransactionResponse } from '@/app/WalletKit/walletKitSchema';
import { CryptoPayoutOrder } from '@/db/xata';
import { ENABLED_ASSETS } from '@/config/whatsAppBot';
import { decimalToString } from '@/resources/utils/currency';
import { getPayoutSpenderWalletAddress } from '@/app/CryptoPayout/config';
import env from '@/constants/env';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import logger, { logSync } from '@/resources/logger';
import { spawn } from 'child_process';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import { ExtendedWalletSupportedNetworks } from '@/app/ExtendedWallet/extendedWalletSchema';
import { isExtendedNetwork } from '@/app/ExtendedWallet/utils';

type CryptoOrderInput = {
    recipient: string;
    amount: string;
    orderId: string;
};

export type CryptoPendingOrderGroup = {
    tokenAddress: string;
    network: SupportedChain | ExtendedWalletSupportedNetworks;
    orders: Array<CryptoOrderInput>;
};

type ProcessCryptoPayoutGroupResponse = {
    submittedOrders: Array<TransferCryptoForIndividualOrderResponse>;
    unSubmittedOrders: CryptoPendingOrderGroup['orders'];
};
type TransferCryptoForIndividualOrderResponse = {
    transactionResponse: TransactionResponse;
    order: CryptoOrderInput;
};

class CryptoPayoutCronJobService {
    public static async execute() {
        const validPendingCryptoPayoutOrders =
            await CryptoPayoutService.getValidPendingCryptoPayoutOrders();

        const groupedOrders = this.groupCryptoOrdersByTokenAndNetwork(
            validPendingCryptoPayoutOrders
        );

        const promises = groupedOrders.map((group) => {
            return this.processCryptoPayoutGroup(group);
        });

        const processingResults = await Promise.allSettled(promises);

        const successfulResults = processingResults.filter(
            (result) => result.status === 'fulfilled'
        ) as Array<PromiseFulfilledResult<ProcessCryptoPayoutGroupResponse | undefined>>;

        const successfulGroupOrders = successfulResults.map((result) => result.value);

        const allUnsubmittedOrderIds: string[][] = [];

        successfulGroupOrders.filter(Boolean).forEach((group) => {
            if (group) {
                group.submittedOrders.forEach((order) => {
                    this.getTransactionReceiptInBackground(
                        order.order.orderId,
                        order.transactionResponse.transaction_id
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
    }

    private static getTransactionReceiptInBackground(orderId: string, transactionId: string) {
        const serializedParams = JSON.stringify({
            orderIds: [orderId],
            transactionId,
        });

        // Spawn the background process
        const backgroundProcess = spawn(
            'tsx',
            ['./getTransactionReceiptInBackground.ts', serializedParams],
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
        if (isExtendedNetwork(group.network)) {
            // Todo: Implement extended network payout
            return;
        }

        const spenderWalletAddress = getPayoutSpenderWalletAddress(
            group.network,
            env.WEB3_ENVIRONMENT
        );

        if (!spenderWalletAddress) {
            throw new Error(`No spender wallet address found for ${group.network}`);
        }

        const tokenBalance = await WalletKitService.getBalance(
            spenderWalletAddress,
            group.network,
            group.tokenAddress
        );

        const processableOrdersInGroup: CryptoPendingOrderGroup['orders'] = [];
        const unProcessableOrdersInGroup: CryptoPendingOrderGroup['orders'] = [];

        let tokenBalanceNumber = Number(tokenBalance);
        group.orders.forEach((order) => {
            if (tokenBalanceNumber >= Number(order.amount)) {
                processableOrdersInGroup.push(order);
                tokenBalanceNumber -= Number(order.amount);
            } else {
                unProcessableOrdersInGroup.push(order);
            }
        });

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
                        spenderWalletAddress,
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
            spenderWalletAddress: string;
        }
    ) {
        if (isExtendedNetwork(config.network)) {
            // Todo: Implement extended network payout
            throw new Error('Extended network payout not implemented');
        }

        const transactionResponse = await WalletKitService.transferToken({
            amount: order.amount,
            network: config.network,
            developer_secret: env.WALLET_KIT_MAINNET_DEVELOPER_SECRET, // Do not change this for now
            token: config.tokenAddress,
            from: config.spenderWalletAddress,
            recipient: order.recipient,
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
        logger
            .info(`Failed to process ${orders.length} payout orders`, {
                group,
                orders,
                walletBalance,
            })
            .then(() => console.log('Logged'));
    }

    public static groupCryptoOrdersByTokenAndNetwork(pendingOrders: Array<CryptoPayoutOrder>) {
        const groupedOrders: Array<CryptoPendingOrderGroup> = [];

        pendingOrders.forEach((order) => {
            const assetConfig = ENABLED_ASSETS.find((asset) => {
                return (
                    asset.tokenName.toLowerCase() === order.tokenSymbol.toLowerCase() &&
                    asset.network.toLowerCase() === order.network.toLowerCase()
                );
            });

            if (!assetConfig) {
                return;
            }

            const existingGroup = groupedOrders.find(
                (group) =>
                    group.tokenAddress === assetConfig.tokenAddress &&
                    group.network === assetConfig.network
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
                });
            }
        });

        return groupedOrders;
    }
}

export default CryptoPayoutCronJobService;
