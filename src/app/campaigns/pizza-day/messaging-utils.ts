import { BuyPizzaPromptArgs } from '@/app/campaigns/pizza-day/schema';
import { PaymentTransactionDetails } from '@/app/campaigns/pizza-day/types';
import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import {
    ExploreAssetActions,
    PhoneNumberParams,
    WhatsAppInteractiveMessage,
    WhatsAppMediaMessage,
    WhatsAppTextMessage,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import BvnKycVerificationFlow from '@/app/WhatsAppBot/WhatsAppFlows/BvnKycVerificationFlow';
import { PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import WhatsAppBotTransactionConfirmationFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransactionConfirmationFlowService';
import { defaultQueueRemoveOptions, queues } from '@/background-processing/queues';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import env from '@/constants/env';
import { FOUR, THREE } from '@/constants/numbers';
import { PIZZA_CAMPAIGN_ENDED_RESPONSE } from '@/constants/strings';
import { UserV2Record } from '@/db/xata';
import { fixNumber, prettifyNumber } from '@/resources/utils/currency';
import { convertAsciiStringToBase64, encryptWithAES } from '@/resources/utils/encryption';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { CountryCode } from 'libphonenumber-js/types';
import * as math from 'mathjs';
import stringSimilarity from 'string-similarity-js';
import { z } from 'zod';

type BuyPizzaPromptParams = {
    whatsappParams: PhoneNumberParams;
    user: UserV2Record;
    args: BuyPizzaPromptArgs | null;
};
type BuyPizzaPromptResponse = {
    rawText: string;
    botResponseMessage?: WhatsAppTextMessage | WhatsAppMediaMessage | WhatsAppInteractiveMessage;
    resetSession: boolean;
};

const PAYMENT_PROMPT_EXAMPLE = 'Pay *NGN 10,000* to 0123456789 Moniepoint';
const MIN_BUY = 5000;

/////////////////////////////////////////////////////////
// Deterministic execution flow for /buy_pizza command
/////////////////////////////////////////////////////////
export const handleBuyPizzaPrompt = async (
    params: BuyPizzaPromptParams
): Promise<BuyPizzaPromptResponse> => {
    const { args, user, whatsappParams } = params;

    const campaignIsEnabled = await FeatureFlagService.isFeatureEnabled(
        FeatureFlagKey.PIZZA_DAY_CAMPAIGN
    );

    if (!campaignIsEnabled) {
        return {
            rawText: PIZZA_CAMPAIGN_ENDED_RESPONSE,
            resetSession: true,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                PIZZA_CAMPAIGN_ENDED_RESPONSE
            ),
        };
    }

    const userKycStatus = userServiceV2.formatKycStatus(user.kycStatus);

    if (
        userKycStatus === 'unverified' ||
        userKycStatus === 'rejected' ||
        userKycStatus === 'pending'
    ) {
        await WhatsAppBotService.sendKycVerificationUrlMessage(user, whatsappParams);

        return {
            rawText: 'Sent KYC verification init message',
            resetSession: false,
        };
    }

    if (userKycStatus === 'in_review') {
        const bvnVerificationMessageText =
            'One last step to complete your KYC verification. Please verify your BVN.';
        const bvnVerificationMessage = BvnKycVerificationFlow.withPhoneNumberId(
            whatsappParams.businessPhoneNumberId as PhoneNumberId
        ).createBvnVerificationFlowMessage(user, {
            messageBody: bvnVerificationMessageText,
            messageRecipient: whatsappParams.userPhoneNumber,
            flowCTA: 'Verify BVN',
        });

        return {
            rawText: bvnVerificationMessageText,
            resetSession: false,
            botResponseMessage: bvnVerificationMessage,
        };
    }

    if (args === null || Object.keys(args).length === 0) {
        const missingArgsPromptResponse = [
            `🍕 Let's get your pizza payment sorted!`,
            `Please tell me how much you're paying and which bank account should receive it.`,
            `Example: "${PAYMENT_PROMPT_EXAMPLE}"`,
        ].join('\n');

        return {
            rawText: missingArgsPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                missingArgsPromptResponse
            ),
        };
    }

    if (args.fiatAmount === null) {
        const missingAmountPromptResponse = [
            `💰 I need to know how much you're paying for the pizza.`,
            `Please reply with the amount in naira. For example: "Pay 10,000 to 0123456789 Moniepoint"`,
        ].join('\n');

        return {
            rawText: missingAmountPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                missingAmountPromptResponse
            ),
        };
    }
    if (args.destinationAccountNumber === null) {
        const missingAccountPromptResponse = [
            `🏦 I need the bank account number where the pizza payment should go.`,
            `Please include it like this: "${PAYMENT_PROMPT_EXAMPLE}"`,
        ].join('\n');

        return {
            rawText: missingAccountPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                missingAccountPromptResponse
            ),
        };
    }
    if (args.destinationBankName === null) {
        const missingBankPromptResponse = [
            `🏦 I need the name of the bank receiving the payment.`,
            `Please include it in your message like this: "${PIZZA_CAMPAIGN_ENDED_RESPONSE}"`,
        ].join('\n');

        return {
            rawText: missingBankPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                missingBankPromptResponse
            ),
        };
    }
    if (args.fiatCurrency === null) {
        const missingCurrencyPromptResponse = [
            `💱 What currency are you paying in?`,
            `Please include it in your message. For example: "${PAYMENT_PROMPT_EXAMPLE}"`,
        ].join('\n');

        return {
            rawText: missingCurrencyPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                missingCurrencyPromptResponse
            ),
        };
    }
    if (args.fiatAmount < MIN_BUY) {
        const belowMinAmountPromptResponse = [
            `🚫 The amount you're trying to pay is too low.`,
            `The minimum payment allowed is ₦${MIN_BUY.toLocaleString()}. Please enter an amount equal to or above that.`,
        ].join('\n');

        return {
            rawText: belowMinAmountPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                belowMinAmountPromptResponse
            ),
        };
    }
    if (args.fiatCurrency.toUpperCase() !== 'NGN') {
        const unsupportedCurrencyPromptResponse = [
            `❌ Sorry, we currently only accept payments in NGN (Nigerian Naira).`,
            `Please update your request to use NGN. For example: "${PIZZA_CAMPAIGN_ENDED_RESPONSE}"`,
        ].join('\n');

        return {
            rawText: unsupportedCurrencyPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                unsupportedCurrencyPromptResponse
            ),
        };
    }

    const [paymentChannels, countries] = await Promise.all([
        FiatRampService.getPaymentMethods('NG', 'offramp'),
        FiatRampService.getSupportedCurrencies(),
    ]);
    const bankPaymentMethod = paymentChannels.paymentChannels.find(
        (channel) => channel.channelName === 'bank'
    );

    const NIGERIA = countries.find((country) => country.code === 'NG');

    if (!NIGERIA) {
        throw new Error('Country object not found');
    }
    const NIGERIAN_COUNTRY_CODE = NIGERIA.code as CountryCode;

    const allBanks = await FiatRampService.getSupportedBanks(
        NIGERIAN_COUNTRY_CODE,
        bankPaymentMethod?.channelId!
    );
    const possibleBank = await bankSearcher(allBanks, args.destinationBankName);
    const targetBank = allBanks.find((bank) => possibleBank?.networkId === bank.networkId);

    if (!targetBank) {
        const noBankFoundMessage = [
            `Hmm, I couldn't match that bank name to any of the supported options.`,
            `Please double-check the spelling or try again with the full bank name, like "Moniepoint" or "Access Bank".`,
        ].join('\n');

        return {
            rawText: noBankFoundMessage,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                noBankFoundMessage
            ),
        };
    }

    const nameValidation = await FiatRampService.resolveBankAccount({
        networkId: targetBank.networkId,
        accountNumber: args.destinationAccountNumber,
        seerbitId: targetBank.seerbitId!,
        countryCode: NIGERIAN_COUNTRY_CODE,
    });
    if (!nameValidation) {
        const accountNameValidationFailedMessage = [
            `I couldn't verify the account name for that bank account.`,
            `Please make sure the account number and bank name are correct and try again.`,
        ].join('\n');

        return {
            rawText: accountNameValidationFailedMessage,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                accountNameValidationFailedMessage
            ),
        };
    }

    const allPromises = azzaWalletManager
        .getSupportedNetworks()
        .map((network) => azzaWalletManager.getNetworkBalances(user.id, network));
    const [quotes, networkAssetsInfo] = await Promise.all([
        FiatRampService.getQuotes(
            args.fiatCurrency.toUpperCase(),
            NIGERIAN_COUNTRY_CODE,
            'offramp'
        ),
        Promise.all(allPromises),
    ]);

    const balances = networkAssetsInfo.flat();
    const convertedAmountInUsd = args.fiatAmount / quotes.rate;

    const feeConfig = FiatRampService.calculateTransactionFeeUsd({
        usdAmount: convertedAmountInUsd,
        conditionalFeePercentageConfigs: quotes.conditionalFeePercentConfigs,
        minFeeUsd: quotes.minFeeUsd,
        defaultFeePercentage: quotes.rawFeePercentage,
        rampType: 'offramp',
    });

    const transactionFee = fixNumber(feeConfig.feeUsd, THREE);
    const feePercentage = feeConfig.feePercentage;

    const amountToDebit = fixNumber(math.add(convertedAmountInUsd, transactionFee), FOUR);

    const sellableBalances = balances.filter(
        (balance) =>
            !balance.asset.isNative &&
            balance.asset.supportedAssetActions.includes(ExploreAssetActions.SELL_ASSET)
    );
    const possiblePaymentBalances = sellableBalances.filter(
        (balance) => (balance?.convertedBalanceUsd ?? 0) >= amountToDebit
    );

    if (possiblePaymentBalances.length === 0) {
        const balanceLines = sellableBalances.map((balance) => {
            const tokenName = balance.asset.tokenName; // e.g., 'USDC'
            const networkName = balance.asset.network; // e.g., 'Base'
            const formattedBalance = fixNumber(balance.convertedBalanceUsd ?? 0, 2);
            return `- ${tokenName} (${networkName}): $${formattedBalance}`;
        });

        const noPaymentBalanceMessage = [
            `You need approximately $${amountToDebit} to pay for this pizza (including a ${feePercentage * 100}% fee).`,
            ``,
            `Here’s what you currently have in *sellable* assets:`,
            ...balanceLines,
            ``,
            `Other assets in your wallet may not be eligible for selling right now.`,
            `To continue, please fund your wallet with a supported asset using the /deposit command.`,
        ].join('\n');

        return {
            rawText: noPaymentBalanceMessage,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                noPaymentBalanceMessage
            ),
        };
    }

    const paymentAsset = possiblePaymentBalances[0];

    const transactionSummary = `Pay ${args.fiatCurrency} ${prettifyNumber(args.fiatAmount, 2)} to ${args.destinationAccountNumber} ${args.destinationBankName}.\n\n*Account Name: ${nameValidation.accountName}*\n\nDebit Amount: ${amountToDebit} ${paymentAsset.asset.tokenName}`;

    const transactionSummaryMessage = `${transactionSummary}\n\nReply "Yes" to confirm.\n\n_To edit any of the details, reply with the correct details. E.g: "Pay NGN 5,000 instead" or "Pay to Access Bank"_`;

    if (!args.hasConfirmedPayment) {
        return {
            rawText: transactionSummaryMessage,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                transactionSummaryMessage
            ),
        };
    }

    const beneficiaryId = await FiatRampService.createBeneficiary(
        `payment-${user.id}`,
        'NG',
        'bank',
        {
            beneficiary: {
                accountName: nameValidation.accountName,
                seerbitId: targetBank.seerbitId,
                nameEnquiryReference: nameValidation.sessionId,
                bankName: targetBank.name,
                accountNumber: args.destinationAccountNumber,
                channelId: targetBank.channelId,
                networkId: targetBank.networkId,
                countryId: NIGERIA.id,
            },
        }
    );

    const message = WhatsAppBotTransactionConfirmationFlowService.withPhoneNumberId(
        whatsappParams.businessPhoneNumberId as PhoneNumberId
    ).createTransactionConfirmationFlowMessage({
        transactionSummary: transactionSummary.replaceAll('*', ''),
        transactionMessageBody: `Click on the button below to enter your transaction PIN and complete your transaction.\n\nTransaction Summary: ${transactionSummary}`,
        msgRecipient: whatsappParams.userPhoneNumber,
        transactionDetails: {
            transactionType: 'PAYMENT',
            fiatAmount: args.fiatAmount,
            usdAmount: convertedAmountInUsd,
            transactionFeeUsd: transactionFee,
            beneficiaryId,
            userId: user.id,
            tokenAmountToDebit: amountToDebit,
            conversionRate: quotes.rate,
            platformFeePercentage: feePercentage,
            assetId: paymentAsset.asset.listItemId,
        },
    });

    return {
        rawText: message.interactive.body.text,
        resetSession: true,
        botResponseMessage: message,
    };
};

export const addPaymentJobForProcessing = async (
    transactionPin: string,
    userPhoneNumber: string,
    jobId: string,
    params: PaymentTransactionDetails
) => {
    const assetConfig = getAssetConfigOrThrow(params.assetId);
    const [userWallet, hotWalletAddress] = await Promise.all([
        azzaWalletManager.getUserWallet(params.userId, assetConfig.network),
        FiatRampService.getHotWalletForNetwork(assetConfig.network),
    ]);

    // Process in background and return early processing response
    await queues.eventDrivenOfframp.add(
        'initiate offramp request',
        {
            offrampParams: {
                beneficiaryId: params.beneficiaryId,
                usdAmount: params.usdAmount,
                localAmount: params.fiatAmount,
                userWalletAddress: userWallet.address,
                hotWalletAddress,
                userId: convertAsciiStringToBase64(params.userId),
                platformFeePercentage: params.platformFeePercentage,
                conversionRate: params.conversionRate,
                transactionFeeUsd: params.transactionFeeUsd,
                assetId: params.assetId,
                tokenAmountToDebit: params.tokenAmountToDebit,
            },
            transactionPin: encryptWithAES(
                transactionPin,
                env.SECURITY_QUESTIONS_MASK_KEY,
                env.SECURITY_QUESTIONS_MASK_IV
            ),
            whatsappParams: {
                userPhoneNumber: userPhoneNumber,
                businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
            },
        },
        {
            ...defaultQueueRemoveOptions,
            jobId,
        }
    );
};

const bankSchema = z.object({
    bankName: z.string(),
    networkId: z.string(),
    confidence: z.number(),
});
export type BankSearchResult = z.infer<typeof bankSchema>;

const bankSearcher = async (
    banks: Awaited<ReturnType<typeof FiatRampService.getSupportedBanks>>,
    bankNameInput: string
): Promise<BankSearchResult | null> => {
    // === Fuzzy Match First ===
    const matchedBank = banks.find((b) => stringSimilarity(bankNameInput, b.name) >= 0.5);

    if (matchedBank) {
        return {
            bankName: matchedBank.name,
            networkId: matchedBank.networkId,
            confidence: stringSimilarity(bankNameInput, matchedBank.name),
        };
    }

    // === Fallback to LLM ===
    const banksString = banks
        .map((bank, index) => `${index + 1}. ${bank.name}:${bank.networkId}`)
        .join('\n');

    const result = await generateObject({
        model: openai('gpt-4o-mini'),
        system: `You are a bank name resolver. Below is a numbered list of supported banks. Each item is formatted as "Bank Name:networkId". Your job is to find the closest matching bank based ONLY on the input provided by the user. Do not use external knowledge or make assumptions beyond this list.

        ----------------
        ${banksString}
        ----------------

        Given a user’s input (e.g. a bank name or part of one), find the most relevant entry from the list above. Return the exact "bankName" and "networkId" as they appear in the list. If no good match is found, return null.`,
        prompt: bankNameInput,
        schema: z.object({
            bankQueryResult: bankSchema.optional().nullable(),
        }),
        temperature: 0,
    });

    return result.object.bankQueryResult ?? null;
};
