import { AssetBalance } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import { PayPromptArgs } from '@/app/pay/schema';
import { PaymentTransactionDetails } from '@/app/pay/types';
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
import { UserV2Record } from '@/db/xata';
import { fixNumber, prettifyNumber } from '@/resources/utils/currency';
import {
    convertAsciiStringToBase64,
    convertBase64ToAsciiString,
    encryptWithAES,
} from '@/resources/utils/encryption';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { CountryCode } from 'libphonenumber-js/types';
import * as math from 'mathjs';
import stringSimilarity from 'string-similarity-js';
import { z } from 'zod';
import { PAY_FEATURE_UNAVAILABLE_RESPONSE } from '@/constants/strings';

type PayPromptParams = {
    whatsappParams: PhoneNumberParams;
    user: UserV2Record;
    args: PayPromptArgs | null;
};
type PayPromptResponse = {
    rawText: string;
    botResponseMessage?: WhatsAppTextMessage | WhatsAppMediaMessage | WhatsAppInteractiveMessage;
    resetSession: boolean;
};

const PAYMENT_PROMPT_EXAMPLE = 'Pay *NGN 10,000* to 0123456789 Moniepoint';
const MIN_PAY = {
    NGN: 1800,
};

// Helper function to generate progressive summary
const generateProgressiveSummary = (args: PayPromptArgs): string[] => {
    const summary: string[] = [];

    if (args.fiatAmount !== null && args.fiatCurrency !== null) {
        summary.push(`✅ Amount: *${args.fiatCurrency} ${args.fiatAmount.toLocaleString()}*`);
    }

    if (args.destinationBankName !== null) {
        summary.push(`✅ Bank: *${args.destinationBankName}*`);
    }

    if (args.destinationAccountNumber !== null) {
        summary.push(`✅ Account: *${args.destinationAccountNumber}*`);
    }

    return summary;
};

// Helper function to identify missing fields
const getMissingFields = (args: PayPromptArgs | null): string[] => {
    if (!args) return ['amount', 'bank', 'account'];

    const missing: string[] = [];

    if (args.fiatAmount === null) missing.push('amount');
    if (args.destinationBankName === null) missing.push('bank');
    if (args.destinationAccountNumber === null) missing.push('account');
    if (args.fiatCurrency === null) missing.push('currency');

    return missing;
};

// Helper function to generate multi-field prompt
const generateMultiFieldPrompt = (missingFields: string[]): string => {
    const fieldPrompts: { [key: string]: string } = {
        amount: "1️⃣ How much you're paying (e.g. 5000)",
        bank: '2️⃣ The bank name (e.g. Moniepoint)',
        account: '3️⃣ The account number (e.g. 0123456789)',
        currency: '4️⃣ The currency (NGN for naira)',
    };

    const promptLines = missingFields.map((field) => fieldPrompts[field]).filter(Boolean);

    return [
        `💵 Let's get your payment ready!`,
        `Please tell me:`,
        ...promptLines,
        ``,
        `You can provide all details in one message like: "${PAYMENT_PROMPT_EXAMPLE}"`,
    ].join('\n');
};

/////////////////////////////////////////////////////////
// Deterministic execution flow for /pay command
/////////////////////////////////////////////////////////
export const handlePayPrompt = async (params: PayPromptParams): Promise<PayPromptResponse> => {
    const { args, user, whatsappParams } = params;

    const featureIsEnabled = await FeatureFlagService.isFeatureEnabled(FeatureFlagKey.NGN_PAY);

    if (!featureIsEnabled) {
        return {
            rawText: PAY_FEATURE_UNAVAILABLE_RESPONSE,
            resetSession: true,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                PAY_FEATURE_UNAVAILABLE_RESPONSE
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
            resetSession: true,
        };
    }

    if (userKycStatus === 'in_review') {
        const isNgUser = user?.country?.toUpperCase().startsWith('NG');
        const messageText = isNgUser
            ? 'One last step to complete your KYC verification. Please verify your BVN.'
            : `Your KYC verification is currently under review. Please wait for it to be completed before proceeding with payments.\n\n If you need assistance, please send /support.`;

        const botResponseMessage = isNgUser
            ? BvnKycVerificationFlow.withPhoneNumberId(
                  whatsappParams.businessPhoneNumberId as PhoneNumberId
              ).createBvnVerificationFlowMessage(user, {
                  messageBody: messageText,
                  messageRecipient: whatsappParams.userPhoneNumber,
                  flowCTA: 'Verify BVN',
              })
            : MessageGenerators.generateTextMessage(whatsappParams.userPhoneNumber, messageText);

        return {
            botResponseMessage,
            rawText: messageText,
            resetSession: true,
        };
    }

    const setArgumentKeys = Object.keys(args ?? {});

    // Check if no args or only hasConfirmedPayment is set
    if (
        args === null ||
        setArgumentKeys.length === 0 ||
        (setArgumentKeys.length === 1 && setArgumentKeys[0] === 'hasConfirmedPayment')
    ) {
        const missingArgsPromptResponse = generateMultiFieldPrompt(['amount', 'bank', 'account']);

        return {
            rawText: missingArgsPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                missingArgsPromptResponse
            ),
        };
    }

    // Get missing fields and progressive summary
    const missingFields = getMissingFields(args);
    const progressSummary = generateProgressiveSummary(args);

    // Handle multiple missing fields with combined prompt
    if (missingFields.length > 1) {
        const combinedPrompt = [
            ...progressSummary,
            '',
            `🔜 Still need:`,
            ...getMissingFields(args).map((field, index) => {
                const fieldPrompts: { [key: string]: string } = {
                    amount: `${index + 1}️⃣ Payment amount (e.g. 5000)`,
                    bank: `${index + 1}️⃣ Bank name (e.g. Moniepoint)`,
                    account: `${index + 1}️⃣ Account number (e.g. 0123456789)`,
                    currency: `${index + 1}️⃣ Currency (NGN for naira)`,
                };
                return fieldPrompts[field];
            }),
        ].join('\n');

        return {
            rawText: combinedPrompt,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                combinedPrompt
            ),
        };
    }

    // Handle individual missing fields with adaptive prompting
    if (args.fiatAmount === null) {
        const summary = progressSummary.length > 0 ? progressSummary.join('\n') + '\n\n' : '';
        const missingAmountPromptResponse = `${summary}💰 Got it — now how much are you paying? Just the amount in naira (e.g. 5000).`;

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
        const summary = progressSummary.length > 0 ? progressSummary.join('\n') + '\n\n' : '';
        const missingAccountPromptResponse = `${summary}🔢 Perfect! Now I need the account number (e.g. 0123456789).`;

        return {
            rawText: missingAccountPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                missingAccountPromptResponse
            ),
        };
    }

    if (args.destinationAccountNumber.length < 10 || args.destinationAccountNumber.length > 10) {
        const incorrectAccountPromptResponse = `Please cross-check the account number to ensure correctness, it's  usually 10-digits.`;

        return {
            rawText: incorrectAccountPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                incorrectAccountPromptResponse
            ),
        };
    }

    if (args.destinationBankName === null) {
        const summary = progressSummary.length > 0 ? progressSummary.join('\n') + '\n\n' : '';
        const missingBankPromptResponse = `${summary}🏦 Great! Which bank should receive the payment? (e.g. Moniepoint, Access Bank)`;

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
        const summary = progressSummary.length > 0 ? progressSummary.join('\n') + '\n\n' : '';
        const missingCurrencyPromptResponse = `${summary}💱 Almost there! What currency are you paying in? (Reply "NGN" for naira)`;

        return {
            rawText: missingCurrencyPromptResponse,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                missingCurrencyPromptResponse
            ),
        };
    }

    if (args.fiatCurrency.toUpperCase() !== 'NGN') {
        const unsupportedCurrencyPromptResponse = [
            `❌ Sorry, we currently only accept Nigerian Naira (NGN).`,
            `Please reply with "NGN" as your currency.`,
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

    // Validation checks
    if (args.fiatAmount < MIN_PAY.NGN) {
        const belowMinAmountPromptResponse = [
            `🚫 The amount is too low for payment.`,
            `Minimum amount: ₦${MIN_PAY.NGN.toLocaleString()}. Please enter a higher amount.`,
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
            `🔍 Hmm, I couldn't find that bank name.`,
            `Please double-check the spelling or try the full name (e.g. "Moniepoint", "Access Bank", "GTBank").`,
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

    const nameValidation = await tryOrNull(
        FiatRampService.resolveBankAccount({
            networkId: targetBank.networkId,
            accountNumber: args.destinationAccountNumber,
            seerbitId: targetBank.seerbitId!,
            countryCode: NIGERIAN_COUNTRY_CODE,
        })
    );

    if (!nameValidation) {
        const accountNameValidationFailedMessage = [
            `❌ I couldn't verify that account number with ${targetBank.name}.`,
            `Please double-check both the account number and bank name, then try again.`,
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
            const tokenName = balance.asset.tokenName;
            const networkName = balance.asset.network;
            const formattedBalance = fixNumber(balance.convertedBalanceUsd ?? 0, 2);
            return `- ${tokenName} (${networkName}): $${formattedBalance}`;
        });

        const noPaymentBalanceMessage = [
            `💳 Insufficient balance for this payment.`,
            ``,
            `Required: *$${amountToDebit}* (including $${feeConfig.feeUsd} fee)`,
            ``,
            `Your sellable assets:`,
            ...balanceLines,
            ``,
            `💡 Use /deposit to add funds to your wallet.`,
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

    // Find the selected asset with disambiguation support
    const assetSelection = findSelectedAsset(possiblePaymentBalances, args);

    // Handle ambiguous asset selection
    if (!args.hasConfirmedPayment && assetSelection.isAmbiguous) {
        const disambiguationMessage = generateDisambiguationMessage(
            assetSelection.matches,
            args.selectedAsset?.tokenName ?? args.selectedAsset?.blockchainNetwork ?? ''
        );

        return {
            rawText: disambiguationMessage,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                disambiguationMessage
            ),
        };
    }

    const paymentAsset = assetSelection.asset;

    // Verify the selected asset exists and has sufficient balance
    if (!paymentAsset || (paymentAsset.convertedBalanceUsd ?? 0) < amountToDebit) {
        const invalidAssetMessage = args.selectedAsset?.tokenName
            ? [
                  `❌ ${args.selectedAsset?.tokenName} doesn't have sufficient balance or isn't available.`,
                  ``,
                  `💰 Available options:`,
                  ...possiblePaymentBalances.slice(0, 3).map((asset) => formatAssetOption(asset)),
                  ``,
                  `💡 Try specifying the chain too, like "USDC Base" or "USDT Bep20"`,
              ].join('\n')
            : `❌ No valid payment asset found. Please try again.`;

        return {
            rawText: invalidAssetMessage,
            resetSession: false,
            botResponseMessage: MessageGenerators.generateTextMessage(
                whatsappParams.userPhoneNumber,
                invalidAssetMessage
            ),
        };
    }

    const transactionSummary = `Pay ${args.fiatCurrency} ${prettifyNumber(args.fiatAmount, 2)} to ${args.destinationAccountNumber} ${args.destinationBankName}.\n\n*Account Name: ${nameValidation.accountName}*\n\nDebit Amount: ${amountToDebit} ${paymentAsset.asset.tokenName}`;

    // Enhanced confirmation message with structured editing options
    const transactionSummaryMessage =
        possiblePaymentBalances.length > 1
            ? generateAssetConfirmation(
                  args,
                  possiblePaymentBalances,
                  amountToDebit,
                  nameValidation,
                  paymentAsset
              )
            : [
                  `*Review your payment:*`,
                  ``,
                  `💰 Amount: *₦${args.fiatAmount.toLocaleString()}*`,
                  `🏦 To: *${args.destinationBankName} — ${args.destinationAccountNumber}*`,
                  `👤 Name: *${nameValidation.accountName}*`,
                  ``,
                  `💳 *Payment Method:*`,
                  `✅ ${paymentAsset.asset.tokenName} (${paymentAsset.asset.network})`,
                  `Debit: ${fixNumber(amountToDebit, 4)} ${paymentAsset.asset.tokenName}`,
                  ``,
                  `✅ Reply "Yes" to confirm`,
                  `✏️ Reply "Change amount to X" to edit details`,
              ].join('\n');

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
        transactionMessageBody: `Click on "Confirm Transaction" to enter your transaction PIN.\n\nTransaction Summary: ${transactionSummary}`,
        msgRecipient: whatsappParams.userPhoneNumber,
        transactionDetails: {
            transactionType: 'PAYMENT',
            fiatAmount: args.fiatAmount,
            usdAmount: convertedAmountInUsd,
            transactionFeeUsd: transactionFee,
            beneficiaryId,
            userId: convertAsciiStringToBase64(user.id),
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
        azzaWalletManager.getUserWallet(
            convertBase64ToAsciiString(params.userId),
            assetConfig.network
        ),
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
                userId: params.userId,
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
    confidence: z.number().optional().nullable().default(1),
});
export type BankSearchResult = z.infer<typeof bankSchema>;

const bankSearcher = async (
    banks: Awaited<ReturnType<typeof FiatRampService.getSupportedBanks>>,
    bankNameInput: string
): Promise<BankSearchResult | null> => {
    // === Fuzzy Match First ===
    const matchedBank = banks.find((b) => stringSimilarity(bankNameInput, b.name) >= 0.9);

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

        Given a user’s input (e.g. a bank name or part of one), find the most relevant entry from the list above. Return the exact "bankName" and "networkId" as they appear in the list, including a "confidence" parameter. If no good match is found, return null.`,
        prompt: bankNameInput,
        schema: z.object({
            bankQueryResult: bankSchema.optional().nullable(),
        }),
        temperature: 0,
    });

    return result.object.bankQueryResult ?? null;
};

const formatAssetOption = (balance: AssetBalance): string => {
    const formattedBalance = fixNumber(balance.convertedBalanceUsd ?? 0, 2);
    return `• ${balance.asset.tokenName} (${balance.asset.network}) - ${formattedBalance} ${balance.asset.tokenName}`;
};

// Helper function to find selected asset based on user input
const findSelectedAsset = (
    possibleAssets: AssetBalance[],
    args: PayPromptArgs | null
): { asset: AssetBalance; isAmbiguous: boolean; matches: AssetBalance[] } => {
    if (!args || (!args.selectedAssetIndex && args.selectedAssetIndex === null)) {
        return {
            asset: possibleAssets[0],
            isAmbiguous: false,
            matches: [],
        };
    }

    // Handle numbered selection (1, 2, 3, etc.)
    if (args.selectedAssetIndex !== null && args.selectedAssetIndex !== undefined) {
        const index = args.selectedAssetIndex - 1; // Convert to 0-based index
        if (index >= 0 && index < possibleAssets.length) {
            return {
                asset: possibleAssets[index],
                isAmbiguous: false,
                matches: [],
            };
        }
    }

    if (!args.selectedAsset) {
        return {
            asset: possibleAssets[0],
            isAmbiguous: false,
            matches: [],
        };
    }

    const userInput = args.selectedAsset;

    // Strategy 1: Exact match with chain (e.g., "usdc base", "eth ethereum")
    const exactWithChain = possibleAssets.find((item) => {
        const tokenName = item.asset.tokenName.toLowerCase();
        const networkName = item.asset.network.toLowerCase();
        return (
            userInput.tokenName?.toLowerCase() === tokenName &&
            userInput.blockchainNetwork?.toLowerCase() === networkName
        );
    });

    if (exactWithChain) {
        return {
            asset: exactWithChain,
            isAmbiguous: false,
            matches: [],
        };
    }

    // Strategy 2: Token symbol matches
    const tokenMatches = possibleAssets.filter(
        (item) => item.asset.tokenName.toLowerCase() === userInput.tokenName?.toLowerCase()
    );

    // If only one match, return it
    if (tokenMatches.length === 1) {
        return {
            asset: tokenMatches[0],
            isAmbiguous: false,
            matches: [],
        };
    }

    // If multiple matches, it's ambiguous
    if (tokenMatches.length > 1) {
        // Prioritize by balance (highest first) as a tie-breaker
        const sortedMatches = tokenMatches.sort(
            (a, b) => (b.convertedBalanceUsd ?? 0) - (a.convertedBalanceUsd ?? 0)
        );

        return {
            asset: sortedMatches[0], // Return highest balance as default
            isAmbiguous: true,
            matches: sortedMatches,
        };
    }

    // Strategy 3: Partial network name matching (e.g., "base" matches "Base")
    const networkMatch = possibleAssets.find(
        (item) =>
            item.asset.network.toLowerCase() === userInput.tokenName?.toLowerCase() ||
            userInput.blockchainNetwork?.toLowerCase() === item.asset.network.toLowerCase()
    );

    if (networkMatch) {
        return {
            asset: networkMatch,
            isAmbiguous: false,
            matches: [],
        };
    }

    // Strategy 4: Fuzzy matching for typos
    const fuzzyMatches = possibleAssets
        .map((item) => ({
            asset: item,
            tokenSimilarity: stringSimilarity(
                userInput.tokenName?.toLowerCase() ?? '',
                item.asset.tokenName.toLowerCase()
            ),
            networkSimilarity: stringSimilarity(
                userInput.blockchainNetwork?.toLowerCase() ?? '',
                item.asset.network.toLowerCase()
            ),
        }))
        .filter((match) => match.tokenSimilarity > 0.7 || match.networkSimilarity > 0.7)
        .sort(
            (a, b) =>
                Math.max(b.tokenSimilarity, b.networkSimilarity) -
                Math.max(a.tokenSimilarity, a.networkSimilarity)
        );

    if (fuzzyMatches.length > 0) {
        return {
            asset: fuzzyMatches[0].asset,
            isAmbiguous: false,
            matches: [],
        };
    }

    // Fallback to first asset
    return {
        asset: possibleAssets[0],
        isAmbiguous: false,
        matches: [],
    };
};

// Helper function to generate disambiguation message
const generateDisambiguationMessage = (matches: AssetBalance[], userInput: string): string => {
    return [
        `🤔 I found multiple ${userInput.toUpperCase()} tokens. Which one did you mean?`,
        ``,
        ...matches.map(
            (item, index) =>
                `${index + 1}️⃣ ${item.asset.tokenName} on ${item.asset.network} (${fixNumber(item.convertedBalanceUsd ?? 0, 2)})`
        ),
        ``,
        `Reply with the number or specify like "${userInput} ${matches[0].asset.network.toLowerCase()}"`,
    ].join('\n');
};

const generateAssetConfirmation = (
    args: PayPromptArgs,
    allAssets: AssetBalance[],
    amountToDebit: number,
    nameValidation: NonNullable<Awaited<ReturnType<typeof FiatRampService.resolveBankAccount>>>,
    selectedAsset: AssetBalance // Add selectedAsset as a parameter
): string => {
    const alternatives = allAssets.filter(
        (asset) =>
            asset.asset.listItemId !== selectedAsset.asset.listItemId &&
            allAssets.indexOf(asset) < 3 // Limit to 3 alternatives
    );
    const hasMore = allAssets.length - 1 > alternatives.length;

    return [
        `*Review your payment:*`,
        ``,
        `💰 Amount: *₦${args.fiatAmount!.toLocaleString()}*`,
        `🏦 To: *${args.destinationBankName} — ${args.destinationAccountNumber}*`,
        `👤 Name: *${nameValidation.accountName}*`,
        ``,
        `💳 *Payment Method:*`,
        `✅${selectedAsset.asset.tokenName} (${selectedAsset.asset.network})`,
        `Debit: ${fixNumber(amountToDebit, 4)} ${selectedAsset.asset.tokenName}`,
        ``,
        alternatives.length > 0 ? `🔄 *Or pay with:*` : 'skip',
        ...alternatives.map((asset) => formatAssetOption(asset)),
        hasMore ? `• "Show more options" for additional assets` : 'skip',
        ``,
        `✅ Reply "Yes" to confirm`,
        alternatives.length > 0
            ? `🔄 Reply "Pay with ${alternatives[0]?.asset.tokenName} ${alternatives[0]?.asset.network}" to switch payment method`
            : 'skip',
        `✏️ Reply "Change amount to X" to edit details`,
    ]
        .filter((line) => line !== 'skip')
        .join('\n');
};

const tryOrNull = async <T>(promise: Promise<T>): Promise<T | null> => {
    try {
        return await promise;
    } catch (e) {
        return null;
    }
};
