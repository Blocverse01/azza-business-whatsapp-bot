import { CryptoPayoutOrderStatus } from '@/app/CryptoPayout/cryptoPayoutSchema';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import { SupportedChain, TransactionResponse } from '@/app/WalletKit/walletKitSchema';
import { CryptoPayoutOrder } from '@/Db/xata';
import { ENABLED_ASSETS } from '@/config/whatsAppBot';
import { decimalToString } from '@/Resources/utils/currency';
import { getPayoutSpenderWalletAddress } from '@/app/CryptoPayout/config';
import env from '@/constants/env';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import logger from '@/Resources/logger';

export type CryptoPendingOrderGroup = {
    tokenAddress: string;
    network: SupportedChain;
    orders: Array<{
        recipient: string;
        amount: string;
        orderId: string;
    }>;
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

        const results = await Promise.allSettled(promises);

        const successfulResults = results.filter(
            (result) => result.status === 'fulfilled'
        ) as Array<
            PromiseFulfilledResult<{
                transactionResponse: TransactionResponse;
                processableOrdersInGroup: CryptoPendingOrderGroup['orders'];
                unProcessableOrdersInGroup: CryptoPendingOrderGroup['orders'];
            }>
        >;
    }

    private static async processCryptoPayoutGroup(group: CryptoPendingOrderGroup) {
        await CryptoPayoutService.updateCryptoPayoutOrdersStatus(
            group.orders.map((order) => order.orderId),
            CryptoPayoutOrderStatus.PROCESSING
        );

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

        const transactionResponse = await WalletKitService.batchTransferToken({
            token: group.tokenAddress,
            network: group.network,
            from: spenderWalletAddress,
            developer_secret: env.WALLET_KIT_DEVELOPER_SECRET,
            transfers: processableOrdersInGroup,
        });

        if (unProcessableOrdersInGroup.length > 0) {
            await this.handleUnprocessableOrdersInGroup(
                unProcessableOrdersInGroup,
                group,
                tokenBalanceNumber
            );
        }

        return {
            transactionResponse,
            processableOrdersInGroup,
            unProcessableOrdersInGroup,
        };
    }

    private static async handleUnprocessableOrdersInGroup(
        orders: CryptoPendingOrderGroup['orders'],
        group: CryptoPendingOrderGroup,
        walletBalance: number
    ) {
        const orderIds = orders.map((order) => order.orderId);

        logger
            .info(`Failed to process ${orders.length} payout orders`, {
                group,
                orders,
                walletBalance,
            })
            .then(() => console.log('Logged'));

        await CryptoPayoutService.updateCryptoPayoutOrdersStatus(
            orderIds,
            CryptoPayoutOrderStatus.PENDING
        );
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
