import { SendTransferTransactionResponse } from '@/app/azza/lib/azza.lib.transaction';
import {
    ExtendedWalletSupportedNetworks,
    ExtendedWalletTransaction,
} from '@/app/ExtendedWallet/extendedWalletSchema';
import { isExtendedNetwork } from '@/app/ExtendedWallet/utils';
import azzaWalletManager from '@/app/runtime/wallet';
import UserService from '@/app/User/UserService';
import { SupportedChain, TransactionResponse } from '@/app/WalletKit/walletKitSchema';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import env from '@/constants/env';
import { delay } from '@/resources/utils/delay';
import { getAppDefaultEvmConfig, isEvmNetwork } from '@/resources/web3/evm/evm.config';
import { getPublicClient } from '@/resources/web3/evm/viem/clients';
import { getTransactionExplorerUrl } from '@/resources/web3/explorerUrls';
import { Hex } from 'viem';

type TransactionDetails = TransactionResponse | ExtendedWalletTransaction;

const finalStateStatuses = ['success', 'failed'] as const;

type FinalStateStatus = (typeof finalStateStatuses)[number];

export const waitForTransactionReceipt = async function waitForTransactionReceipt(
    transaction: SendTransferTransactionResponse,
    resolvedTransactionHash?: string | null
) {
    let transactionDetails: TransactionDetails;

    const { transactionId, userId, asset, walletManager } = transaction;

    if (walletManager === 'new') {
        return waitForTransactionReceiptV2(transaction);
    }

    if (isExtendedNetwork(asset.network)) {
        const extendedWallet = await UserService.getExtendedWallet(userId, asset.network);
        transactionDetails = await extendedWallet.getTransaction(transactionId);
    } else {
        transactionDetails = resolvedTransactionHash
            ? await getReceiptWithTransactionHash(resolvedTransactionHash, asset.network)
            : await WalletKitService.getTransactionById(transactionId);
    }

    const transactionHash =
        'transaction_hash' in transactionDetails
            ? transactionDetails.transaction_hash
            : transactionDetails.transactionHash;

    if (!isFinalState(transactionDetails.status)) {
        await delay(5000);
        return waitForTransactionReceipt(transaction, transactionHash);
    }

    if (!transactionHash) {
        throw new Error('Transaction hash not found');
    }

    return {
        transactionHash,
        status: transactionDetails.status as FinalStateStatus,
        explorerUrl: getTransactionExplorerUrl(transactionHash as string, asset.network),
    };
};

function isFinalState(status: string): status is FinalStateStatus {
    return finalStateStatuses.includes(status as FinalStateStatus);
}

export async function getReceiptWithTransactionHash(
    transactionHash: string,
    network: SupportedChain | ExtendedWalletSupportedNetworks
) {
    if (!isExtendedNetwork(network) && isEvmNetwork(network)) {
        const networkConfig = getAppDefaultEvmConfig(network, env.WEB3_ENVIRONMENT);
        const publicClient = getPublicClient(networkConfig.viemChain, networkConfig.rpcUrl);

        const transactionReceipt = await publicClient.waitForTransactionReceipt({
            hash: transactionHash as Hex,
        });

        return {
            transactionHash: transactionReceipt.transactionHash,
            status: transactionReceipt.status,
            explorerUrl: getTransactionExplorerUrl(transactionHash as string, network),
        };
    } else {
        return await WalletKitService.getTransactionByHash(
            transactionHash,
            network as SupportedChain
        );
    }
}

export async function waitForTransactionReceiptV2(transaction: SendTransferTransactionResponse) {
    const { transactionId, asset, walletManager } = transaction;

    if (walletManager !== 'new') {
        throw new Error('Incompatible transaction params');
    }

    const assetTransaction = await azzaWalletManager.getTransaction(transactionId, asset.network);

    if (assetTransaction.status === 'PENDING') {
        await delay(5000);
        return waitForTransactionReceiptV2(transaction);
    }

    const transactionHash = assetTransaction.hash;

    return {
        transactionHash,
        status: assetTransaction.status.toLowerCase() as FinalStateStatus,
        explorerUrl: transactionHash
            ? getTransactionExplorerUrl(transactionHash as string, asset.network)
            : null,
    };
}
