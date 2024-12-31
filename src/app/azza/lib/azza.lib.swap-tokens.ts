import { SwapTokensTransactionDetails } from '@/app/azza/azza.schema';
import { getDefaultSolanaNode, getSolanaNetworkClient } from '@/app/ExtendedWallet/solana/config';
import ExtendedSolanaWalletLibrary from '@/app/ExtendedWallet/solana/ExtendedSolanaWalletLibrary';
import { isExtendedNetwork } from '@/app/ExtendedWallet/utils';
import { ChainsSupportedByLifi } from '@/app/LiFi/LiFiIntegrationLibrary';
import UserService from '@/app/User/UserService';
import Web3Library from '@/app/WalletAssetManagement/Web3Library';
import { TransactionResponse } from '@/app/WalletKit/walletKitSchema';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { ExploreAssetActions, manageAssetActions } from '@/app/WhatsAppBot/WhatsAppBotType';
import { searchAsset } from '@/config/whatsAppBot';
import env from '@/constants/env';
import { ZERO } from '@/constants/numbers';
import { ADDRESS_ZERO } from '@/constants/strings';
import logger from '@/resources/logger';
import { prettifyNumber } from '@/resources/utils/currency';
import { delay } from '@/resources/utils/delay';
import { compareHashedString } from '@/resources/utils/hashing';
import { validateWalletAddress } from '@/resources/utils/validators';
import { SPENDING_APPROVAL_ABI } from '@/resources/web3/evm/abis/erc20';
import { getAppDefaultEvmConfig } from '@/resources/web3/evm/evm.config';
import { getPublicClient } from '@/resources/web3/evm/viem/clients';
import { TokenNames } from '@/resources/web3/tokens';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { Address, encodeFunctionData, formatUnits, getAddress, Hex, parseUnits } from 'viem';

export const sendSwapTransaction = async (params: SwapTokensTransactionDetails) => {
    const {
        toToken,
        fromToken,
        fromChain,
        fromAmount,
        userId,
        approvalAddress,
        transactionRequest,
        transactionPin,
        toChain,
    } = params;

    if (!userId) {
        throw new Error('User ID is required');
    }
    if (!transactionPin) {
        throw new Error('Transaction pin is required');
    }

    const fromAssetConfig = searchAsset({
        network: fromChain,
        tokenName: fromToken.symbol,
    })[0];

    const [user, userWallet] = await Promise.all([
        UserService.getUserByPhoneNumber(userId),
        UserService.getOrCreateUserAssetWallet(userId, fromAssetConfig.listItemId),
    ]);

    if (!user?.transactionPinHash) {
        throw new Error('Transaction pin not set');
    }

    if (!(await compareHashedString(transactionPin, user.transactionPinHash))) {
        throw new Error('Invalid transaction pin');
    }

    const prettifiedFromAmount = prettifyNumber(
        Number(formatUnits(BigInt(fromAmount), fromToken.decimals)),
        6
    );
    const transactionSummaryForWhatsApp = `🔄 *_Swap ${prettifiedFromAmount} ${fromToken.symbol} to ${toToken.symbol}_*`;

    const fromBalance =
        fromChain === 'Solana'
            ? await (async () => {
                  const connection = getSolanaNetworkClient(getDefaultSolanaNode());

                  if (!validateWalletAddress(fromToken.id, fromChain)) {
                      return await ExtendedSolanaWalletLibrary.getWalletNativeBalance(
                          connection,
                          new PublicKey(userWallet.walletAddress)
                      );
                  }
                  return await ExtendedSolanaWalletLibrary.getWalletTokenBalance(
                      connection,
                      new PublicKey(fromToken.id),
                      new PublicKey(userWallet.walletAddress)
                  );
              })()
            : await (async () => {
                  const networkConfig = getAppDefaultEvmConfig(fromChain, env.WEB3_ENVIRONMENT);
                  const publicClient = getPublicClient(
                      networkConfig.viemChain,
                      networkConfig.rpcUrl
                  );

                  if (
                      fromToken.id === ADDRESS_ZERO ||
                      !validateWalletAddress(fromToken.id, fromChain)
                  ) {
                      return await Web3Library.getNativeBalance(
                          publicClient,
                          getAddress(userWallet.walletAddress)
                      );
                  }

                  return await Web3Library.getHumanReadableTokenBalance(
                      publicClient,
                      getAddress(fromToken.id),
                      getAddress(userWallet.walletAddress)
                  );
              })();

    void logger.debug('Swap parameters', {
        fromToken,
        toToken,
        fromChain,
        fromAmount,
        userId,
        approvalAddress,
        transactionRequest,
        toChain,
        fromBalance,
    });

    if (parseUnits(`${fromBalance}`, fromToken.decimals) < BigInt(fromAmount)) {
        await WhatsAppBotService.sendArbitraryTextMessage(
            userId,
            `❌ *Your swap transaction failed*\n\nSummary: ${transactionSummaryForWhatsApp}\n\nReason for failure: you have insufficient ${fromToken.symbol}.`
        );
        return;
    }

    let finalApprovalResponse:
        | TransactionResponse
        | {
              status: TransactionResponse['status'];
              explorerUrl: string | null;
          }
        | null = null;

    if (
        approvalAddress &&
        validateWalletAddress(approvalAddress, fromChain) &&
        validateWalletAddress(fromToken.id, fromChain) &&
        fromToken.id !== ADDRESS_ZERO
    ) {
        //Todo: Get current allowance and check if it is enough before sending approval transaction
        const approvalTransactionData = encodeFunctionData({
            abi: SPENDING_APPROVAL_ABI,
            functionName: 'approve',
            args: [getAddress(approvalAddress), BigInt(fromAmount)],
        });

        const approvalResponse = await WalletKitService.signAndSendTransaction({
            signer_wallet_address: userWallet.walletAddress as Address,
            network: fromChain,
            unsigned_transaction: {
                to: fromToken.id as Hex,
                input: approvalTransactionData as Hex,
            },
            developer_secret: WalletKitService.DEVELOPER_SECRET,
        });

        finalApprovalResponse = await waitForFinalTransactionReceipt(
            approvalResponse.transaction_id,
            userId,
            fromChain
        );
    }

    if (finalApprovalResponse && finalApprovalResponse.status !== 'success') {
        await WhatsAppBotService.sendArbitraryTextMessage(
            userId,
            `❌ *Your transaction failed*\n\nSummary: ${transactionSummaryForWhatsApp}\n\nReason for failure: allowance approval transaction failed.`
        );
        return;
    }

    let transactionId: string | null = null;

    if (isExtendedNetwork(fromChain)) {
        const extendedWallet = await UserService.getExtendedWallet(userId, fromChain);

        if (fromChain === 'Solana' && transactionRequest?.data) {
            const keypair = ExtendedSolanaWalletLibrary.getKeyPairFromPrivateKeyString(
                extendedWallet.privateKey
            );

            const decodedTx = new Uint8Array(Buffer.from(transactionRequest.data, 'base64'));
            const deserializedTx = VersionedTransaction.deserialize(decodedTx);

            deserializedTx.sign([keypair]);

            transactionId = await ExtendedSolanaWalletLibrary.sendTransactionWithRetries(
                getSolanaNetworkClient(getDefaultSolanaNode()),
                deserializedTx,
                keypair
            );
        }
    } else {
        transactionId = (
            await WalletKitService.signAndSendTransaction({
                signer_wallet_address: userWallet.walletAddress as Address,
                network: fromChain,
                unsigned_transaction: {
                    to: transactionRequest.to as Hex,
                    input: transactionRequest.data as Hex,
                    value:
                        fromToken.symbol === TokenNames.ETH
                            ? (transactionRequest.value as Hex)
                            : undefined,
                },
                developer_secret: WalletKitService.DEVELOPER_SECRET,
            })
        ).transaction_id;
    }

    if (!transactionId) {
        throw new Error('Error sending transaction');
    }

    await WhatsAppBotService.sendArbitraryTextMessage(
        userId,
        `⏺️ *Your swap transaction is being processed*\n\nSummary: ${transactionSummaryForWhatsApp}\n\nRequest ID: ${transactionId}\n\n_Usually takes a few minutes to complete._`
    );

    const swapTxFinalResponse = await waitForFinalTransactionReceipt(
        transactionId,
        userId,
        fromChain
    );

    if (swapTxFinalResponse.status === 'success') {
        const assetConfig = searchAsset({
            network: toChain,
            tokenName: toToken.symbol,
        })[ZERO];

        if (!assetConfig) {
            throw new Error('Asset config not found');
        }

        const userAssetInfo = await UserService.getUserAssetInfo(userId, assetConfig.listItemId);

        const actionsToDisplay = manageAssetActions.filter((action) => {
            const supportedActions = assetConfig.supportedAssetActions as ExploreAssetActions[];
            return (
                supportedActions.includes(action.action) &&
                action.action !== 'buy' &&
                action.action !== 'deposit'
            );
        });

        const interactiveListMessage = MessageGenerators.generateInteractiveListMessage({
            recipient: userId,
            listItems: actionsToDisplay.map((assetAction) => ({
                id: `${assetAction.action}:${assetConfig.listItemId}`,
                title: assetAction.text,
                description: assetAction.description,
            })),
            bodyText: `✅ *Your swap transaction has been completed*\n\nSummary: ${transactionSummaryForWhatsApp}\n\nYou now have: ${userAssetInfo.tokenBalanceDisplay} ${assetConfig.tokenName}`,
            headerText: `Transaction Completed`,
            actionButtonText: `Spend ${assetConfig.tokenName}`,
        });

        await WhatsAppBotService.sendWhatsappMessage(
            env.WA_PHONE_NUMBER_ID,
            interactiveListMessage
        );
    } else {
        const explorerUrl =
            'explorer_url' in swapTxFinalResponse
                ? swapTxFinalResponse.explorer_url!
                : swapTxFinalResponse.explorerUrl;

        const message = MessageGenerators.generateInteractiveCtaUrlButtonMessage({
            bodyText: `❌ *Your swap transaction failed*\n\nSummary: ${transactionSummaryForWhatsApp}\n\n_Please try again later or contact support for assistance._`,
            ctaText: 'View In Explorer',
            ctaUrl: explorerUrl!,
            recipient: userId,
            headerText: 'Transaction Failed',
            footerText: 'Thank you for using Azza!',
        });

        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
    }
};

async function waitForFinalTransactionReceipt(
    transactionId: string,
    userId: string,
    network: ChainsSupportedByLifi
) {
    const transactionDetails = await (async () => {
        if (isExtendedNetwork(network)) {
            const extendedWallet = await UserService.getExtendedWallet(userId, network);

            return await extendedWallet.getTransaction(transactionId);
        } else {
            return await WalletKitService.getTransactionById(transactionId);
        }
    })();

    if (transactionDetails.status === 'submitted' || transactionDetails.status === 'pending') {
        await delay(3000);

        return waitForFinalTransactionReceipt(transactionId, userId, network);
    }

    return transactionDetails;
}
