import { ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS } from '@/app/CryptoPayout/config';
import CryptoPayoutService from '@/app/CryptoPayout/CryptoPayoutService';
import { SendOfframpRequestPayload } from '@/app/FiatRamp/fiatRampSchema';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import logger, { logSync } from '@/resources/logger';
import { SupportedChain, TransactionResponse } from '@/app/WalletKit/walletKitSchema';
import {
    ExtendedWalletSupportedNetworks,
    ExtendedWalletTransaction,
} from '@/app/ExtendedWallet/extendedWalletSchema';
import { isExtendedNetwork } from '@/app/ExtendedWallet/utils';
import UserService from '@/app/User/UserService';
import { delay } from '@/resources/utils/delay';
import { getAppDefaultEvmConfig, isEvmNetwork } from '@/resources/web3/evm/evm.config';
import { getPublicClient } from '@/resources/web3/evm/viem/clients';
import { getTransactionExplorerUrl } from '@/resources/web3/explorerUrls';
import { TokenNames } from '@/resources/web3/tokens';
import { Hex } from 'viem';
import MessageGenerators from '../../MessageGenerators';

export type ProcessOfframpInBackgroundParams = Omit<SendOfframpRequestPayload, 'txHash'> & {
    onChainTransactionId: string;
    network: SupportedChain | ExtendedWalletSupportedNetworks;
    userId: string;
};

const offrampParams: ProcessOfframpInBackgroundParams = JSON.parse(process.argv[2]);

type TransactionDetails = TransactionResponse | ExtendedWalletTransaction;

const finalStateStatuses: TransactionResponse['status'][] = ['success', 'failed'];

async function processInBackground(
    txParams: ProcessOfframpInBackgroundParams,
    resolvedTransactionHash?: string | null
) {
    const { onChainTransactionId, userId } = txParams;

    try {
        let transactionDetails: TransactionDetails;

        if (isExtendedNetwork(txParams.network)) {
            const extendedWallet = await UserService.getExtendedWallet(userId, txParams.network);
            transactionDetails = await extendedWallet.getTransaction(onChainTransactionId);
        } else {
            transactionDetails = resolvedTransactionHash
                ? await getReceiptWithTransactionHash(resolvedTransactionHash, txParams.network)
                : await WalletKitService.getTransactionById(onChainTransactionId);
        }

        const transactionHash =
            'transaction_hash' in transactionDetails
                ? transactionDetails.transaction_hash
                : transactionDetails.transactionHash;

        if (
            !finalStateStatuses.includes(transactionDetails.status) ||
            transactionDetails.status === 'dropped'
        ) {
            await delay(5000);
            return processInBackground(txParams, transactionHash);
        }

        await logger.info('Transaction details', {
            transactionDetails,
            txParams,
            transactionHash,
        });

        if (transactionDetails.status === 'success' && transactionHash) {
            try {
                logSync('debug', 'Processing offramp', {
                    onChainTransactionId,
                });

                const sequenceId = await FiatRampService.postOfframpTransaction({
                    ...txParams,
                    txHash: transactionHash,
                    chainName: txParams.chainName.toUpperCase(),
                    tokenName: txParams.tokenName.toUpperCase(),
                });

                await logger.info('Offramp transaction processed successfully', { sequenceId });

                return;
            } catch (error) {
                if (
                    transactionHash &&
                    ENABLED_NETWORKS_FOR_ONRAMP_PAYOUTS.includes(txParams.network as SupportedChain)
                ) {
                    if (
                        txParams.tokenName === TokenNames.USDC ||
                        txParams.tokenName === TokenNames.USDT
                    ) {
                        await CryptoPayoutService.createOfframpCryptoRefundOrder({
                            network: txParams.network as SupportedChain,
                            tokenSymbol: txParams.tokenName,
                            triggerTransactionId: transactionHash,
                            ownerId: userId,
                            amount: txParams.usdAmount,
                            destinationWalletAddress: txParams.userWalletAddress,
                        });
                    }

                    await WhatsAppBotService.sendWhatsappMessage(
                        env.WA_PHONE_NUMBER_ID,
                        MessageGenerators.generateTextMessage(
                            userId,
                            `An error occurred while sending your transaction.\nYour ${txParams.tokenName} will be refunded to your wallet.`
                        )
                    );
                }

                await logServiceError(error, 'Sending offramp transaction failed');

                return;
            }
        }

        await logger.info(`Didn't send offramp transaction`, {
            transactionDetails,
            txParams,
        });

        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            MessageGenerators.generateTextMessage(
                userId,
                `An error occurred while sending your transaction.\nPlease reach out to support if your ${txParams.tokenName} was debited.`
            )
        );
    } catch (error) {
        await logServiceError(error, 'Offramp background process failed:');
        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            MessageGenerators.generateTextMessage(
                userId,
                `An error occurred while sending your transaction.\nPlease reach out to support if your ${txParams.tokenName} was debited.`
            )
        );
    }
}

async function getReceiptWithTransactionHash(
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

processInBackground(offrampParams).then(() => console.log('Process completed'));
