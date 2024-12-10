import { SwapTokensOnBaseTransactionDetails } from '@/app/azza/azza.schema';
import UserService from '@/app/User/UserService';
import Web3Library from '@/app/WalletAssetManagement/Web3Library';
import { TransactionResponse } from '@/app/WalletKit/walletKitSchema';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { prettifyNumber } from '@/resources/utils/currency';
import { delay } from '@/resources/utils/delay';
import { compareHashedString } from '@/resources/utils/hashing';
import { validateWalletAddress } from '@/resources/utils/validators';
import { SPENDING_APPROVAL_ABI } from '@/resources/web3/evm/abis/erc20';
import { getAppDefaultEvmConfig } from '@/resources/web3/evm/evm.config';
import { getPublicClient } from '@/resources/web3/evm/viem/clients';
import { Address, encodeFunctionData, formatUnits, getAddress, Hex } from 'viem';

export const sendTokenSwapTransactionOnBase = async (
    params: SwapTokensOnBaseTransactionDetails
) => {
    const {
        userId,
        transactionPin,
        transactionRequest,
        fromToken,
        toToken,
        fromAmount,
        approvalAddress,
    } = params;

    if (!userId) {
        throw new Error('User ID is required');
    }
    if (!transactionPin) {
        throw new Error('Transaction pin is required');
    }

    const [user, userWallet] = await Promise.all([
        UserService.getUserByPhoneNumber(userId),
        WalletKitService.getUserWalletByNetwork(userId, 'Base'),
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

    const appNetworkConfig = getAppDefaultEvmConfig('Base', env.WEB3_ENVIRONMENT);
    const publicClient = getPublicClient(appNetworkConfig.viemChain, appNetworkConfig.rpcUrl);

    const fromBalance = validateWalletAddress(fromToken.id, 'Base')
        ? await Web3Library.getRawTokenBalance(
              publicClient,
              getAddress(fromToken.id),
              getAddress(userWallet.address)
          )
        : await Web3Library.getRawNativeBalance(publicClient, getAddress(userWallet.address));

    if (fromBalance < BigInt(fromAmount)) {
        await WhatsAppBotService.sendArbitraryTextMessage(
            userId,
            `❌ *Your swap transaction failed*\n\nSummary: ${transactionSummaryForWhatsApp}\n\nReason for failure: you have insufficient ${fromToken.symbol}.`
        );
        return;
    }

    let finalApprovalResponse: TransactionResponse | null = null;

    if (
        approvalAddress &&
        validateWalletAddress(approvalAddress, 'Base') &&
        validateWalletAddress(fromToken.id, 'Base')
    ) {
        //  Todo: Get current allowance and check if it is enough before sending approval transaction
        const approvalTransactionData = encodeFunctionData({
            abi: SPENDING_APPROVAL_ABI,
            functionName: 'approve',
            args: [getAddress(approvalAddress), BigInt(fromAmount)],
        });

        const approvalResponse = await WalletKitService.signAndSendTransaction({
            signer_wallet_address: userWallet.address as Address,
            network: 'Base',
            unsigned_transaction: {
                to: fromToken.id as Hex,
                input: approvalTransactionData as Hex,
            },
            developer_secret: WalletKitService.DEVELOPER_SECRET,
        });

        finalApprovalResponse = await waitForFinalTransactionReceipt(
            approvalResponse.transaction_id
        );
    }

    if (finalApprovalResponse && finalApprovalResponse.status !== 'success') {
        await WhatsAppBotService.sendArbitraryTextMessage(
            userId,
            `❌ *Your transaction failed*\n\nSummary: ${transactionSummaryForWhatsApp}\n\nReason for failure: allowance approval transaction failed.`
        );
        return;
    }

    const response = await WalletKitService.signAndSendTransaction({
        signer_wallet_address: userWallet.address as Address,
        network: 'Base',
        unsigned_transaction: {
            to: transactionRequest.to as Hex,
            input: transactionRequest.data as Hex,
            value: transactionRequest.value as Hex,
        },
        developer_secret: WalletKitService.DEVELOPER_SECRET,
    });

    await WhatsAppBotService.sendArbitraryTextMessage(
        userId,
        `⏺️ *Your swap transaction is being processed*\n\nSummary: ${transactionSummaryForWhatsApp}\n\nRequest ID: ${response.transaction_id}\n\n_Usually takes a few minutes to complete._`
    );

    const finalResponse = await waitForFinalTransactionReceipt(response.transaction_id);

    if (finalResponse.status === 'success') {
        const message = MessageGenerators.generateInteractiveCtaUrlButtonMessage({
            bodyText: `✅ *Your swap transaction has been completed*\n\nSummary: ${transactionSummaryForWhatsApp}\n\nRequest ID: ${response.transaction_id}`,
            ctaText: 'View In Explorer',
            ctaUrl: finalResponse.explorer_url!,
            recipient: userId,
            headerText: 'Transaction Completed',
            footerText: 'Thank you for using Azza!',
        });

        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
    } else {
        const message = MessageGenerators.generateInteractiveCtaUrlButtonMessage({
            bodyText: `❌ *Your swap transaction failed*\n\nSummary: ${transactionSummaryForWhatsApp}\n\n_Please try again later or contact support for assistance._`,
            ctaText: 'View In Explorer',
            ctaUrl: finalResponse.explorer_url!,
            recipient: userId,
            headerText: 'Transaction Failed',
            footerText: 'Thank you for using Azza!',
        });

        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
    }
};

async function waitForFinalTransactionReceipt(transactionId: string) {
    const transactionDetails = await WalletKitService.getTransactionById(transactionId);

    if (transactionDetails.status === 'submitted' || transactionDetails.status === 'pending') {
        await delay(3000);

        return waitForFinalTransactionReceipt(transactionId);
    }

    return transactionDetails;
}
