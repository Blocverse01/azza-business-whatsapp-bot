import { dbClient, fiatRampsDbClient } from '@/db/dbClient';
import { OnrampTransactionPayload, SendOnrampTransactionResponse } from '../fiatRampSchema';
import { generateRandomHexString } from '@/resources/utils/encryption';
import userServiceV2 from '@/runtime/user';
import { prettifyNumber } from '@/resources/utils/currency';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import { generateOnrampReceipt } from '@/app/receipts/generators';
import { searchSupportedBlockchain } from '../utils';
import { addCashbackJobToQueue, isCashBackEnabledChain } from '@/app/campaigns/cashbacks/utils';
import { Effect } from 'effect';
import { getPatchedOnrampTxBySequenceId } from '../patches/onramp';
import { addCryptoPayoutJobToQueue } from '@/app/crypto-payouts-v2/utils';
import FiatRampService from '../FiatRampService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import { MANUAL_OFFRAMP_SETTLERS } from './config';

export const MANUAL_ONRAMP_COMPLETE_BUTTON_PREFIX = 'manual_onramp_complete-';

export const initiateManualOnramp = async (
    payload: OnrampTransactionPayload
): Promise<SendOnrampTransactionResponse> => {
    const whitelistedUserBankAccount = await dbClient.ngn_sub_accounts
        .filter({
            user: payload.customerId,
        })
        .getFirst();

    if (!whitelistedUserBankAccount) {
        throw new Error('User has to be whitelisted -- with a sub-account to use this feature');
    }

    const sequenceId = `azza-mc-${generateRandomHexString(16)}`;

    const onrampRecord = await fiatRampsDbClient.yellowcard_onramp_transaction.create({
        localAmount: payload.localAmount,
        tokenAmount: payload.tokenAmount,
        usdAmount: payload.usdAmount,
        tokenSymbol: payload.tokenName,
        transactionFeeInToken: payload.transactionFeeInToken,
        transactionFeeUsd: payload.transactionFeeInToken,
        ownerId: payload.customerId,
        processorName: 'manual',
        yellowCardStatus: 'pending',
        blockchainNetwork: payload.chainName,
        channelId: 'azza-manual',
        collectionAccountName: whitelistedUserBankAccount.accountName,
        collectionAccountNumber: whitelistedUserBankAccount.accountNumber,
        collectionBankName: whitelistedUserBankAccount.bankName,
        collectionAccountType: 'bank',
        collectionCountry: payload.country,
        conversionRate: payload.conversionRate,
        destinationWalletAddress: payload.userWalletAddress,
        platformFeePercentage: payload.platformFeePercentage,
        isAgentTransaction: payload.isAgentTransaction,
        sequenceId,
    });

    const bankInfo = {
        name: whitelistedUserBankAccount.bankName,
        accountName: whitelistedUserBankAccount.accountName,
        accountNumber: whitelistedUserBankAccount.accountNumber,
    };

    await sendAdminMessages(payload, bankInfo, sequenceId);

    return {
        bankInfo,
        sequenceId: onrampRecord.sequenceId,
        amount: payload.localAmount,
        convertedAmount: payload.usdAmount,
    };
};

export const shouldUseManualOnramp = async (userId: string) => {
    const whitelistedUserBankAccount = await dbClient.ngn_sub_accounts
        .filter({
            user: userId,
        })
        .getFirst();

    return !!whitelistedUserBankAccount;
};

const sendAdminMessages = async (
    payload: OnrampTransactionPayload,
    bankInfo: SendOnrampTransactionResponse['bankInfo'],
    sequenceId: string
) => {
    const currencySymbol = (await FiatRampService.getSupportedCurrencies()).find(
        (currency) => currency.code.toLowerCase() === payload.country.toLowerCase()
    )?.currencySymbol;

    const messageBodyText = [
        `*Transaction details*\n`,
        `${currencySymbol ?? ''} Amount: ${payload.localAmount}`,
        `Collection Account Number: ${bankInfo!.accountNumber}`,
        `Collection AccountName: ${bankInfo!.accountName}`,
        `Collection Bank: ${bankInfo!.name}`,
        `\n*Onramp details*\n`,
        `Token Amount: ${payload.tokenAmount} ${payload.tokenName}`,
        `Blockchain: ${payload.chainName}`,
        `\nNEXT STEPS:\n`,
        `- Confirm ${currencySymbol} credit to the collection account`,
        '- Click on Mark as Complete to send a successful confirmatin receipt to the user.',
    ].join('\n');

    const messages = MANUAL_OFFRAMP_SETTLERS.map((settler) =>
        MessageGenerators.generateInteractiveButtonMessage({
            bodyText: messageBodyText,
            headerText: `🔔 New initiated manual onramp alert`,
            replyButtons: [
                {
                    title: 'Mark as Complete',
                    id: `${MANUAL_ONRAMP_COMPLETE_BUTTON_PREFIX}${sequenceId}`,
                },
            ],
            recipient: settler,
        })
    );

    const messagePromises = messages.map((message) =>
        WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message)
    );

    await Promise.all(messagePromises);
};

export const markManualOnrampAsComplete = async (sequenceId: string, markedBy: string) => {
    const transaction = await Effect.runPromise(getPatchedOnrampTxBySequenceId(sequenceId));

    if (transaction.status === 'complete') {
        await WhatsAppBotService.sendArbitraryTextMessage(
            markedBy,
            `Transaction already completed`
        );
        return;
    }

    const recordToUpdate = await fiatRampsDbClient.yellowcard_onramp_transaction
        .filter({
            sequenceId,
        })
        .getFirstOrThrow();
    await recordToUpdate.update({
        yellowCardStatus: 'complete',
        completedBy: markedBy,
    });

    const user = await userServiceV2.getUserById(transaction.ownerId);
    if (!user) throw new Error('User not found');

    const transactionDetailsString = `💲Buy ${transaction.tokenAmount ?? transaction.usdAmount} ${transaction.tokenSymbol} on ${transaction.blockchainNetwork} with ${transaction.localCurrencySymbol} ${prettifyNumber(transaction.localAmount)}`;
    const message = `✅ Your transaction with the following details has been completed:\n\n${transactionDetailsString}\n\nExpect your funds within 1 - 5 minutes`;

    try {
        await WhatsAppBotService.sendArbitraryTextMessage(user.primaryWhatsappPhoneNumber, message);
    } catch (error) {}

    await addCryptoPayoutJobToQueue({
        transactionId: sequenceId,
        transactionType: 'onramp-payout',
    });

    const supportedChain = searchSupportedBlockchain(transaction.blockchainNetwork);

    if (supportedChain && isCashBackEnabledChain(supportedChain)) {
        await addCashbackJobToQueue({
            transactionId: sequenceId,
            transactionType: 'onramp',
            blockchain: supportedChain,
        });
    }

    const receiptBuffer = await generateOnrampReceipt(transaction);
    const uploadedMedia = await WhatsAppBotService.uploadImageToWhatsapp(
        env.WA_PHONE_NUMBER_ID,
        new File([Buffer.from(receiptBuffer)], `receipt-${sequenceId}.png`, {
            type: 'image/png',
        })
    );

    if (uploadedMedia) {
        await WhatsAppBotService.sendMediaMessage(
            {
                userPhoneNumber: user.primaryWhatsappPhoneNumber,
                businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
            },
            {
                media: uploadedMedia,
                caption: `🧾Transaction Receipt`,
                type: 'image',
            }
        );
    }

    await WhatsAppBotService.sendArbitraryTextMessage(
        markedBy,
        `TX with details: \n\n${transactionDetailsString}\n\n marked as complete successfully.`
    );
};
