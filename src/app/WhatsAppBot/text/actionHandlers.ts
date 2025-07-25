import { AssetTransferRecipientType } from '@/app/azza/azza.schema';
import { getDefaultParamsForNetworkFeeQuery } from '@/app/AzzaWalletManager/fallback-data';
import { SwapAssetQuote } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import { handlePayPrompt } from '@/app/pay/messaging-utils';
import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import { getMinimumOfframpUsdAmount } from '@/app/FiatRamp/config';
import { hasExceededLimit } from '@/app/limits/utils';
import { Action } from '@/app/llmCallRouter/inputClassifier';
import { addJobToReferralCodeQueue } from '@/app/referral-scheme/queue-utils';
import {
    aggregatePendingTransactionFeeTokenAmount,
    calculateWithdrawalFees,
} from '@/app/transaction-fees/utils';
import { getWithdrawalMinimum } from '@/app/wallet-withdrawals/limits';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import { actionArgumentsSchema } from '@/app/WhatsAppBot/text/classifiedActionSchema';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { ActionExecuted, ExploreAssetActions, PhoneNumberParams } from '@/app/WhatsAppBot/WhatsAppBotType';
import { PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import WhatsAppBotChangeTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotChangeTransactionPinFlowService';
import WhatsAppBotResetTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotResetTransactionPinFlowService';
import WhatsAppBotTransactionConfirmationFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransactionConfirmationFlowService';
import {
    canAccessFeature,
    deriveUserFeatureAccessLevel,
    type FeatureAccessLevel,
    FLAT_SWAP_FEE,
} from '@/config/whatsAppBot';
import { SIX, ZERO, SOL_RENT_ESTIMATE } from '@/constants/numbers';
import {
    getTransactionMinimumDepositMessage,
    SWAP_UNAVAILABLE_RESPONSE,
    USD_SYMBOL,
    WITHDRAWAL_UNAVAILABLE_RESPONSE,
} from '@/constants/strings';
import { UserV2Record } from '@/db/xata';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import { getNetworkEmoji } from '@/resources/utils/bot-message-utils';
import {
    decimalToString,
    getUserCountryCodeFromPhoneNumberOrThrow,
    prettifyNumber,
} from '@/resources/utils/currency';
import { convertAsciiStringToBase64 } from '@/resources/utils/encryption';
import { cleanPhoneNumberInput } from '@/resources/utils/phone-numbers';
import { clipDecimal } from '@/resources/utils/transformers';
import { validateWalletAddress } from '@/resources/utils/validators';
import {
    isValidBlockchain,
    normalizeBlockchainInput,
    SUPPORTED_BLOCKCHAINS,
} from '@/resources/web3/core/blockchains';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { z, ZodSchema } from 'zod';
import { getSupportContactsMessageText, getSupportedAssetAndNetworksText } from '../utils';
import SumSubService from '@/app/SumSub/SumSubService';
import P2pAgentService from '@/app/User/P2pAgent/P2pAgentService';

type ActionHandlerParams = {
    extractedArguments:
    | z.infer<(typeof actionArgumentsSchema)[Exclude<Action['class'], 'NO_PREDEFINED_ACTION'>]>
    | null
    | Record<string, unknown>;
    botParams: PhoneNumberParams & {
        waDisplayName: string;
    };
    user: UserV2Record;
};

export type PromptHandlerResponse = {
    response: string;
    resetSession: boolean;
};

/////////////////////////////////////////////////////////
//             Deposit Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleDepositRelatedPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { extractedArguments, botParams, user } = params;

    const missingArgsPromptResponse = getAssetChoiceMessage('deposit');
    const missingArgsWhatsAppMessage = MessageGenerators.generateTextMessage(
        params.botParams.userPhoneNumber,
        missingArgsPromptResponse
    );

    if (extractedArguments === null || Object.keys(extractedArguments).length === 0) {
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            missingArgsWhatsAppMessage
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const depositArguments = parseExtractedArguments(
        extractedArguments,
        actionArgumentsSchema.DEPOSIT_CRYPTO_TO_WALLET
    );

    if (!depositArguments.blockchainNetwork || !depositArguments.cryptoCurrencySymbol) {
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            missingArgsWhatsAppMessage
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const targetAsset = azzaWalletManager.searchAssets({
        tokenName: depositArguments.cryptoCurrencySymbol,
        network: depositArguments.blockchainNetwork,
    })[0];

    if (!targetAsset) {
        const assetNotFoundResponse = `${depositArguments.cryptoCurrencySymbol} on the network ${depositArguments.blockchainNetwork} is not supported at the moment. Please try again with a supported asset and network.`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                assetNotFoundResponse
            )
        );
        return {
            response: assetNotFoundResponse,
            resetSession: false,
        };
    }

    const userWalletInfo = await azzaWalletManager.getUserWallet(user.id, targetAsset.network);

    const walletAddressMessage = MessageGenerators.generateTextMessage(
        params.botParams.userPhoneNumber,
        userWalletInfo.address
    );
    const copyInstructionMessage = MessageGenerators.generateTextMessage(
        params.botParams.userPhoneNumber,
        `☝️That’s your deposit address for ${targetAsset.tokenName} on ${targetAsset.network}:\n- Copy the address carefully. (Tap and hold to copy.)\n- Open your external wallet or exchange.\n- Paste the address and send your ${targetAsset.tokenName}.`
    );

    const usdLimit = getMinimumOfframpUsdAmount(targetAsset.network);

    if (usdLimit) {
        const limitAcknowledgeMessageBody = getTransactionMinimumDepositMessage({
            minimum: usdLimit,
            tokenSymbol: targetAsset.tokenName,
            network: targetAsset.network,
        });
        const limitMessage = MessageGenerators.generateInteractiveButtonMessage({
            recipient: botParams.userPhoneNumber,
            bodyText: limitAcknowledgeMessageBody,
            replyButtons: [
                {
                    id: `${ExploreAssetActions.DEPOSIT}:${targetAsset.listItemId}`,
                    title: `I Understand`,
                },
            ],
        });

        await WhatsAppBotService.sendWhatsappMessage(botParams.businessPhoneNumberId, limitMessage);

        return {
            response: limitAcknowledgeMessageBody,
            resetSession: true,
        };
    }

    await WhatsAppBotService.sendWhatsappMessage(
        botParams.businessPhoneNumberId,
        walletAddressMessage
    );
    await WhatsAppBotService.sendWhatsappMessage(
        botParams.businessPhoneNumberId,
        copyInstructionMessage
    );

    return {
        response: `[Message 1]: ${walletAddressMessage.text.body}\n\n[Message 2]: ${copyInstructionMessage.text.body}`,
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//             Withdraw Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleWithdrawRelatedPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { extractedArguments, botParams, user } = params;

    const withdrawalsIsEnabled = await FeatureFlagService.isFeatureEnabled(
        FeatureFlagKey.WALLET_WITHDRAWALS
    );

    if (!withdrawalsIsEnabled) {
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                WITHDRAWAL_UNAVAILABLE_RESPONSE
            )
        );

        return {
            response: WITHDRAWAL_UNAVAILABLE_RESPONSE,
            resetSession: true,
        };
    }

    if (extractedArguments === null || Object.keys(extractedArguments).length === 0) {
        const missingArgsPromptResponse = getWithdrawalArgumentsGuideMessage({
            amount: true,
            recipientAddressOrPhoneNumber: true,
            blockchainNetwork: true,
            cryptoCurrencySymbol: true,
        });

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                missingArgsPromptResponse
            )
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const withdrawArguments = parseExtractedArguments(
        extractedArguments,
        actionArgumentsSchema.TRANSFER_CRYPTO
    );

    if (
        !withdrawArguments.blockchainNetwork ||
        !withdrawArguments.cryptoCurrencySymbol ||
        !withdrawArguments.recipientAddressOrPhoneNumber ||
        withdrawArguments.amount === null
    ) {
        const missingArgsPromptResponse = getWithdrawalArgumentsGuideMessage({
            amount: !withdrawArguments.amount,
            recipientAddressOrPhoneNumber: !withdrawArguments.recipientAddressOrPhoneNumber,
            blockchainNetwork: !withdrawArguments.blockchainNetwork,
            cryptoCurrencySymbol: !withdrawArguments.cryptoCurrencySymbol,
        });
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                missingArgsPromptResponse
            )
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const targetAsset = azzaWalletManager.searchAssets({
        tokenName: withdrawArguments.cryptoCurrencySymbol,
        network: withdrawArguments.blockchainNetwork,
    })[0];

    if (!targetAsset) {
        const assetNotFoundResponse = `${withdrawArguments.cryptoCurrencySymbol} on the network ${withdrawArguments.blockchainNetwork} is not supported at the moment. Please try again with a supported asset and network.`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                assetNotFoundResponse
            )
        );
        return {
            response: assetNotFoundResponse,
            resetSession: false,
        };
    }

    if (!withdrawArguments.recipientAddressOrPhoneNumber) {
        const missingRecipientAddressResponse = `Please provide the wallet address or phone number (on Azza) that will receive the ${targetAsset.tokenName}.`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                missingRecipientAddressResponse
            )
        );

        return {
            response: missingRecipientAddressResponse,
            resetSession: false,
        };
    }

    const withdrawalMinimum = getWithdrawalMinimum(targetAsset.listItemId);

    if (withdrawalMinimum && withdrawArguments.amount < withdrawalMinimum) {
        const withdrawalMinimumResponse = `Minimum withdrawal amount is ${withdrawalMinimum} ${targetAsset.tokenName}`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                withdrawalMinimumResponse
            )
        );

        return {
            response: withdrawalMinimumResponse,
            resetSession: false,
        };
    }

    const balanceInfo = await azzaWalletManager.getAssetBalance({
        userId: user.id,
        assetId: targetAsset.listItemId,
    });
    const pendingFeeAggregate = await aggregatePendingTransactionFeeTokenAmount(
        user.id,
        targetAsset.listItemId
    );

    const availableBalance =
        targetAsset.tokenName === 'SOL'
            ? balanceInfo.balance - pendingFeeAggregate - SOL_RENT_ESTIMATE
            : balanceInfo.balance - pendingFeeAggregate;

    if (availableBalance < withdrawArguments.amount) {
        const insufficientBalanceResponse = `The max you can withdraw is ${availableBalance} ${targetAsset.tokenName}`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                insufficientBalanceResponse
            )
        );

        return {
            response: insufficientBalanceResponse,
            resetSession: false,
        };
    }

    const recipient = withdrawArguments.recipientAddressOrPhoneNumber;

    const isPhoneNumber =
        !validateWalletAddress(recipient, targetAsset.network) &&
        Boolean(cleanPhoneNumberInput(recipient).match(/^\d+$/));

    if (isPhoneNumber) {
        try {
            getUserCountryCodeFromPhoneNumberOrThrow(recipient);
        } catch (error) {
            const countryCodeError = `The phone number '${recipient}' should be in the international format, e.g 2348031234567`;
            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.botParams.userPhoneNumber,
                    countryCodeError
                )
            );
            return {
                response: countryCodeError,
                resetSession: false,
            };
        }
    }

    if (!isPhoneNumber && !validateWalletAddress(recipient, targetAsset.network)) {
        const recipientAddressError = `${recipient} is not a valid wallet address for ${targetAsset.network}`;
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                recipientAddressError
            )
        );
        return {
            response: recipientAddressError,
            resetSession: false,
        };
    }

    const recipientType: AssetTransferRecipientType = isPhoneNumber
        ? AssetTransferRecipientType.PHONE_NUMBER
        : AssetTransferRecipientType.WALLET_ADDRESS;

    const [transactionFee, hasExceededGaslessWithdrawalLimit] = await Promise.all([
        calculateWithdrawalFees({
            amount: withdrawArguments.amount,
            assetId: targetAsset.listItemId,
            userId: user.id,
            recipient: getDefaultParamsForNetworkFeeQuery(targetAsset.network).recipient,
        }),
        hasExceededLimit(user.id, 'GASLESS_TRANSACTIONS'),
    ]);

    if (
        hasExceededGaslessWithdrawalLimit &&
        transactionFee.totalFee > 0 &&
        withdrawArguments.amount <= transactionFee.totalFee
    ) {
        const minAmountResponse = `Minimum withdrawal amount is ${transactionFee.totalFee + withdrawArguments.amount} ${targetAsset.tokenName}`;
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                minAmountResponse
            )
        );
        return {
            response: minAmountResponse,
            resetSession: false,
        };
    }

    const amountToReceive = clipDecimal(
        hasExceededGaslessWithdrawalLimit
            ? withdrawArguments.amount - transactionFee.totalFee
            : withdrawArguments.amount,
        6
    );

    const transactionSummaryMessage = `Please confirm the transfer details:\n\n- Amount: ${withdrawArguments.amount} ${targetAsset.tokenName}\n- Transaction Fee: ${clipDecimal(transactionFee.totalFee, 6)} ${targetAsset.tokenName}${hasExceededGaslessWithdrawalLimit ? '' : ' (💙Sponsored)'}\n- Amount to Receive: ${amountToReceive} ${targetAsset.tokenName}\n\n- Recipient: ${recipient}\n- Chain: ${targetAsset.network}\n\nReply "Yes" to confirm.\n\n_To edit any of the details, reply with the correct details. E.g: "Withdraw 2 USDC instead" or "Withdraw on Ethereum"_`;

    if (!withdrawArguments.hasConfirmedTransfer) {
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                transactionSummaryMessage
            )
        );
        return {
            response: transactionSummaryMessage,
            resetSession: false,
        };
    }

    const message = WhatsAppBotTransactionConfirmationFlowService.withPhoneNumberId(
        botParams.businessPhoneNumberId as PhoneNumberId
    ).createTransactionConfirmationFlowMessage({
        transactionSummary: `Send ${withdrawArguments.amount} ${targetAsset.tokenName} to ${recipient}`,
        transactionMessageBody: `Click on the button below to enter your transaction PIN and complete your transaction.\n\nTransaction Summary: Send ${withdrawArguments.amount} ${targetAsset.tokenName} on ${targetAsset.network} to ${recipient}`,
        msgRecipient: params.botParams.userPhoneNumber,
        transactionDetails: {
            transactionType: 'SEND',
            recipient,
            recipientType,
            amount: amountToReceive,
            assetId: targetAsset.listItemId,
            transactionFee: transactionFee.totalFee,
            transactionFeeUsd: transactionFee.totalFeeUsd,
            userId: convertAsciiStringToBase64(user.id),
        },
    });

    await WhatsAppBotService.sendWhatsappMessage(botParams.businessPhoneNumberId, message);

    return {
        response: message.interactive.body.text,
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//             Balance Query Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleBalanceQueryPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { extractedArguments, botParams, user } = params;

    const balanceQueryArguments = parseExtractedArguments(
        extractedArguments ?? {
            blockchainNetwork: null,
            cryptoCurrencySymbol: null,
        },
        actionArgumentsSchema.QUERY_WALLET_BALANCE
    );

    const { blockchainNetwork, cryptoCurrencySymbol } = balanceQueryArguments;

    const targetAsset =
        cryptoCurrencySymbol && blockchainNetwork
            ? azzaWalletManager.searchAssets({
                tokenName: cryptoCurrencySymbol,
                network: blockchainNetwork,
            })[ZERO]
            : undefined;

    const balanceQueryMode = targetAsset
        ? {
            type: 'asset on specific network' as const,
            entity: targetAsset,
        }
        : blockchainNetwork
            ? {
                type: 'network' as const,
                entity: normalizeBlockchainInput(blockchainNetwork),
            }
            : cryptoCurrencySymbol
                ? {
                    type: 'asset on any network' as const,
                    entity: cryptoCurrencySymbol,
                }
                : {
                    type: 'all' as const,
                };

    const supportedAssets = azzaWalletManager.getSupportedAssets();
    switch (balanceQueryMode.type) {
        case 'asset on specific network': {
            if (!targetAsset) {
                const assetNotFoundResponse = `${cryptoCurrencySymbol} on the network ${blockchainNetwork} is not supported at the moment. Please try again with a supported asset and network.`;

                await WhatsAppBotService.sendWhatsappMessage(
                    botParams.businessPhoneNumberId,
                    MessageGenerators.generateTextMessage(
                        params.botParams.userPhoneNumber,
                        assetNotFoundResponse
                    )
                );
                return {
                    response: assetNotFoundResponse,
                    resetSession: false,
                };
            }

            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.botParams.userPhoneNumber,
                    `*Checking balance for ${targetAsset.tokenName} on ${targetAsset.network}...*`
                )
            );
            const assetBalanceInfo = await azzaWalletManager.getAssetBalance({
                userId: user.id,
                assetId: balanceQueryMode.entity.listItemId,
            });

            const usdBalanceDisplay =
                assetBalanceInfo.convertedBalanceUsd !== undefined
                    ? prettifyNumber(assetBalanceInfo.convertedBalanceUsd, SIX)
                    : null;
            const balanceMessage = `*You have ${assetBalanceInfo.balance} ${targetAsset.tokenName} ${usdBalanceDisplay ? ` (${USD_SYMBOL}${usdBalanceDisplay})` : ''} on ${targetAsset.network}*`;

            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.botParams.userPhoneNumber,
                    balanceMessage
                )
            );

            return {
                response: balanceMessage,
                resetSession: true,
            };
        }

        case 'asset on any network': {
            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.botParams.userPhoneNumber,
                    `*Checking balance for ${balanceQueryMode.entity} on all networks...*`
                )
            );

            const assetIds = supportedAssets
                .filter((asset) => {
                    return asset.tokenName.toLowerCase() === balanceQueryMode.entity.toLowerCase();
                })
                .map((asset) => asset.listItemId);

            const casePromises = assetIds.map((assetId) =>
                azzaWalletManager.getAssetBalance({
                    userId: user.id,
                    assetId,
                })
            );

            const _assetsInfo = await Promise.all(casePromises);
            const assetBalances = Object.fromEntries(
                _assetsInfo.map((assetInfo) => {
                    return [
                        assetInfo.blockchainNetwork,
                        {
                            ...assetInfo,
                            networkEmoji: getNetworkEmoji(assetInfo.blockchainNetwork),
                        },
                    ];
                })
            );

            const networks = Object.keys(assetBalances);

            const balanceMessages = networks
                .map((network) => {
                    const tokenBalanceDisplay = prettifyNumber(assetBalances[network].balance, 6);
                    const usdBalanceDisplay =
                        assetBalances[network].convertedBalanceUsd !== undefined
                            ? prettifyNumber(assetBalances[network].convertedBalanceUsd, SIX)
                            : null;

                    const { networkEmoji, asset } = assetBalances[network];
                    return `*${networkEmoji} ${asset.tokenName} on ${network}*\n- Balance: ${tokenBalanceDisplay} ${asset.tokenName}${usdBalanceDisplay ? ` (${USD_SYMBOL}${usdBalanceDisplay})` : ''}`;
                })
                .join('\n\n');

            const response = `*Your ${balanceQueryMode.entity} balances on different networks:*\n\n${balanceMessages}`;

            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, response)
            );

            return {
                response: response,
                resetSession: true,
            };
        }

        case 'network': {
            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.botParams.userPhoneNumber,
                    `*Checking balance on ${balanceQueryMode.entity}...*`
                )
            );

            const assetsInfo = await azzaWalletManager.getNetworkBalances(
                user.id,
                balanceQueryMode.entity
            );

            const balances = Object.fromEntries(
                assetsInfo.map((assetInfo) => {
                    return [assetInfo.asset.tokenName, assetInfo];
                })
            );

            const networkBalances = Object.keys(balances).map((assetName) => {
                const tokenBalanceDisplay = prettifyNumber(balances[assetName].balance, 6);
                const usdBalanceDisplay =
                    balances[assetName].convertedBalanceUsd !== undefined
                        ? prettifyNumber(balances[assetName].convertedBalanceUsd, SIX)
                        : null;

                return `- ${assetName}: ${tokenBalanceDisplay}${usdBalanceDisplay ? ` (${USD_SYMBOL}${usdBalanceDisplay})` : ''}`;
            });

            const networkBalanceMessage = `*Your balances on ${getNetworkEmoji(balanceQueryMode.entity)} ${balanceQueryMode.entity}:*\n\n${networkBalances.join('\n\n')}`;

            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.botParams.userPhoneNumber,
                    networkBalanceMessage
                )
            );

            return {
                response: networkBalanceMessage,
                resetSession: true,
            };
        }

        case 'all': {
            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.botParams.userPhoneNumber,
                    `Checking balance on all networks...`
                )
            );

            const uniqueNetworks = [...new Set(supportedAssets.map((asset) => asset.network))];
            const allPromises = uniqueNetworks.map((network) =>
                azzaWalletManager.getNetworkBalances(user.id, network)
            );
            const networkAssetsInfo = await Promise.all(allPromises);

            const networkBalancesMessage = networkAssetsInfo
                .map((networkGroup) => {
                    const assetBalances = networkGroup
                        .map((asset) => {
                            const tokenBalanceDisplay = prettifyNumber(asset.balance, 6);
                            const usdBalanceDisplay =
                                asset.convertedBalanceUsd !== undefined
                                    ? prettifyNumber(asset.convertedBalanceUsd, SIX)
                                    : null;

                            return `- ${tokenBalanceDisplay} ${asset.asset.tokenName}${usdBalanceDisplay ? ` (${USD_SYMBOL}${usdBalanceDisplay})` : ''}`;
                        })
                        .join('\n');

                    if (!networkGroup[0]) {
                        return ``;
                    }
                    const network = networkGroup[0]?.blockchainNetwork;

                    const emoji = getNetworkEmoji(network);

                    return `*${emoji ?? ''} ${network}*\n${assetBalances}`;
                })
                .filter((value) => value !== '')
                .join('\n\n');

            const allBalancesMessage = `*Your balances on different networks:*\n\n${networkBalancesMessage}`;

            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.botParams.userPhoneNumber,
                    allBalancesMessage
                )
            );

            return {
                response: allBalancesMessage,
                resetSession: true,
            };
        }
    }
};

/////////////////////////////////////////////////////////
//       Reset Transaction PIN Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleResetTransactionPinPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { botParams, user } = params;

    if (!user?.transactionPinHash) {
        const responseMessage = 'You have not set a transaction pin yet.';
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, responseMessage)
        );

        return {
            response: responseMessage,
            resetSession: false,
        };
    }

    const userSecurityQuestions = userServiceV2.retrieveUserSecurityQuestions(user);

    const message = WhatsAppBotResetTransactionPinFlowService.withPhoneNumberId(
        botParams.businessPhoneNumberId as PhoneNumberId
    ).createTransactionPinResetFlowMessage(user, {
        messageRecipient: botParams.userPhoneNumber,
        messageBody: 'Click on `Reset Transaction PIN` to reset your transaction PIN',
        flowCTA: 'Reset Transaction PIN',
        userSecurityQuestions,
    });

    await WhatsAppBotService.sendWhatsappMessage(botParams.businessPhoneNumberId, message);

    return {
        response: message.interactive.body.text,
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//       Change Transaction PIN Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleChangeTransactionPinPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { botParams, user } = params;

    if (!user?.transactionPinHash) {
        const responseMessage = 'You have not set a transaction pin yet.';
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(botParams.userPhoneNumber, responseMessage)
        );

        return {
            response: responseMessage,
            resetSession: false,
        };
    }

    const message = WhatsAppBotChangeTransactionPinFlowService.withPhoneNumberId(
        botParams.businessPhoneNumberId as PhoneNumberId
    ).createTransactionPinChangeFlowMessage(user, {
        messageRecipient: botParams.userPhoneNumber,
        messageBody: 'Click on `Change Transaction PIN` to change your transaction PIN',
        flowCTA: 'Change Transaction PIN',
    });

    await WhatsAppBotService.sendWhatsappMessage(botParams.businessPhoneNumberId, message);

    return {
        response: message.interactive.body.text,
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//       Buy Crypto With Fiat Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleBuyCryptoWithFiatPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { botParams, extractedArguments, user } = params;

    const missingArgsPromptResponse = getAssetChoiceMessage('buy');
    const missingArgsWhatsAppMessage = MessageGenerators.generateTextMessage(
        params.botParams.userPhoneNumber,
        missingArgsPromptResponse
    );

    if (extractedArguments === null || Object.keys(extractedArguments).length === 0) {
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            missingArgsWhatsAppMessage
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const buyArguments = parseExtractedArguments(
        extractedArguments,
        actionArgumentsSchema.BUY_CRYPTO_WITH_FIAT
    );

    if (!buyArguments.blockchainNetwork || !buyArguments.cryptoCurrencySymbol) {
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            missingArgsWhatsAppMessage
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const targetAsset = azzaWalletManager.searchAssets({
        tokenName: buyArguments.cryptoCurrencySymbol,
        network: buyArguments.blockchainNetwork,
    })[0];

    if (!targetAsset) {
        const assetNotFoundResponse = `${buyArguments.cryptoCurrencySymbol} on the network ${buyArguments.blockchainNetwork} is not supported at the moment.\n\nHere's a list of supported assets and networks:\n${getSupportedAssetAndNetworksText(
            {
                action: ExploreAssetActions.BUY_ASSET,
            }
        )}`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                assetNotFoundResponse
            )
        );
        return {
            response: assetNotFoundResponse,
            resetSession: false,
        };
    }

    if (!targetAsset.supportedAssetActions.includes(ExploreAssetActions.BUY_ASSET)) {
        const assetNotSupportedResponse = `Buying ${targetAsset.tokenName} on ${targetAsset.network} is not supported at the moment. Please try again with a supported asset.`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                assetNotSupportedResponse
            )
        );
        return {
            response: assetNotSupportedResponse,
            resetSession: false,
        };
    }

    await WhatsAppBotService.handleBuyAssetAction(
        user,
        {
            userPhoneNumber: botParams.userPhoneNumber,
            businessPhoneNumberId: botParams.businessPhoneNumberId,
        },
        targetAsset.listItemId,
    );

    return {
        response: 'Handled buy asset action',
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//       Sell Crypto For Fiat Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleSellCryptoForFiatPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { botParams, extractedArguments, user } = params;

    if (extractedArguments === null || Object.keys(extractedArguments).length === 0) {
        const missingArgsPromptResponse = getSellCryptoArgumentsGuideMessage({
            blockchainNetwork: true,
            cryptoCurrencySymbol: true,
        });

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                missingArgsPromptResponse
            )
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const sellArguments = parseExtractedArguments(
        extractedArguments,
        actionArgumentsSchema.SELL_CRYPTO_FOR_FIAT
    );

    if (!sellArguments.blockchainNetwork || !sellArguments.cryptoCurrencySymbol) {
        const missingArgsPromptResponse = getSellCryptoArgumentsGuideMessage({
            blockchainNetwork: !sellArguments.blockchainNetwork,
            cryptoCurrencySymbol: !sellArguments.cryptoCurrencySymbol,
        });

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                missingArgsPromptResponse
            )
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const targetAsset = azzaWalletManager.searchAssets({
        tokenName: sellArguments.cryptoCurrencySymbol,
        network: sellArguments.blockchainNetwork,
    })[0];

    if (!targetAsset) {
        const assetNotFoundResponse = `${sellArguments.cryptoCurrencySymbol} on the network ${sellArguments.blockchainNetwork} is not supported at the moment.\n\nHere's a list of supported assets and networks:\n${getSupportedAssetAndNetworksText(
            {
                action: ExploreAssetActions.SELL_ASSET,
            }
        )}`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                assetNotFoundResponse
            )
        );
        return {
            response: assetNotFoundResponse,
            resetSession: false,
        };
    }

    if (!targetAsset.supportedAssetActions.includes(ExploreAssetActions.SELL_ASSET)) {
        const assetNotSupportedResponse = `Selling ${targetAsset.tokenName} on ${targetAsset.network} is not supported at the moment. Please try again with a supported asset.`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                assetNotSupportedResponse
            )
        );
        return {
            response: assetNotSupportedResponse,
            resetSession: false,
        };
    }

    await WhatsAppBotService.handleSellAssetAction(
        user,
        {
            userPhoneNumber: botParams.userPhoneNumber,
            businessPhoneNumberId: botParams.businessPhoneNumberId,
        },
        targetAsset.listItemId
    );

    return {
        response: 'Handled sell asset action',
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//     Receive Crypto Payment Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleReceiveCryptoPaymentPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {

    const { botParams, user } = params;

    await WhatsAppBotService.handleReceiveCryptoPaymentAction(
        user,
        {
            userPhoneNumber: botParams.userPhoneNumber,
            businessPhoneNumberId: botParams.businessPhoneNumberId,
        }
    );

    return {
        response: 'Handled receive payment action',
        resetSession: true,
    };

};

/////////////////////////////////////////////////////////
//      Agent Sell Crypto For Fiat Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleAgentSellCryptoForFiatPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { botParams, extractedArguments, user } = params;

    const isAgent: boolean = true;

    if (!user.isP2pAgent) {
        await P2pAgentService.sendNotAuthorizedAsAgentMessage({
            businessPhoneNumberId: botParams.businessPhoneNumberId,
            userPhoneNumber: botParams.userPhoneNumber
        })

        return {
            response: ActionExecuted.SEND_NOT_AUTHORIZED_AS_AGENT_MESSAGE,
            resetSession: true,
        };
    }

    if (extractedArguments === null || Object.keys(extractedArguments).length === 0) {
        const missingArgsPromptResponse = getSellCryptoArgumentsGuideMessage({
            blockchainNetwork: true,
            cryptoCurrencySymbol: true,
        });

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                missingArgsPromptResponse
            )
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const sellArguments = parseExtractedArguments(
        extractedArguments,
        actionArgumentsSchema.AGENT_SELL_CRYPTO_FOR_FIAT
    );

    if (!sellArguments.blockchainNetwork || !sellArguments.cryptoCurrencySymbol) {
        const missingArgsPromptResponse = getSellCryptoArgumentsGuideMessage({
            blockchainNetwork: !sellArguments.blockchainNetwork,
            cryptoCurrencySymbol: !sellArguments.cryptoCurrencySymbol,
        });

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                missingArgsPromptResponse
            )
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const targetAsset = azzaWalletManager.searchAssets({
        tokenName: sellArguments.cryptoCurrencySymbol,
        network: sellArguments.blockchainNetwork,
    })[0];

    if (!targetAsset) {
        const assetNotFoundResponse = `${sellArguments.cryptoCurrencySymbol} on the network ${sellArguments.blockchainNetwork} is not supported at the moment.\n\nHere's a list of supported assets and networks:\n${getSupportedAssetAndNetworksText(
            {
                action: ExploreAssetActions.SELL_ASSET,
            }
        )}`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                assetNotFoundResponse
            )
        );
        return {
            response: assetNotFoundResponse,
            resetSession: false,
        };
    }

    if (!targetAsset.supportedAssetActions.includes(ExploreAssetActions.SELL_ASSET)) {
        const assetNotSupportedResponse = `Selling ${targetAsset.tokenName} on ${targetAsset.network} is not supported at the moment. Please try again with a supported asset.`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                assetNotSupportedResponse
            )
        );
        return {
            response: assetNotSupportedResponse,
            resetSession: false,
        };
    }

    await WhatsAppBotService.handleSellAssetAction(
        user,
        {
            userPhoneNumber: botParams.userPhoneNumber,
            businessPhoneNumberId: botParams.businessPhoneNumberId,
        },
        targetAsset.listItemId,
        isAgent
    );

    return {
        response: 'Handled sell asset action',
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//      Agent Buy Crypto For Fiat Related Prompt Handler
//////////////////////////////////////////////////////
export const handleAgentBuyCryptoWithFiatPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { botParams, extractedArguments, user } = params;

    const isAgent: boolean = true;

    if (!user.isP2pAgent) {
        await P2pAgentService.sendNotAuthorizedAsAgentMessage({
            businessPhoneNumberId: botParams.businessPhoneNumberId,
            userPhoneNumber: botParams.userPhoneNumber
        })

        return {
            response: ActionExecuted.SEND_NOT_AUTHORIZED_AS_AGENT_MESSAGE,
            resetSession: true,
        };
    }

    const missingArgsPromptResponse = getAssetChoiceMessage('buy');
    const missingArgsWhatsAppMessage = MessageGenerators.generateTextMessage(
        params.botParams.userPhoneNumber,
        missingArgsPromptResponse
    );

    if (extractedArguments === null || Object.keys(extractedArguments).length === 0) {
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            missingArgsWhatsAppMessage
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const buyArguments = parseExtractedArguments(
        extractedArguments,
        actionArgumentsSchema.AGENT_BUY_CRYPTO_WITH_FIAT
    );

    if (!buyArguments.blockchainNetwork || !buyArguments.cryptoCurrencySymbol) {
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            missingArgsWhatsAppMessage
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const targetAsset = azzaWalletManager.searchAssets({
        tokenName: buyArguments.cryptoCurrencySymbol,
        network: buyArguments.blockchainNetwork,
    })[0];

    if (!targetAsset) {
        const assetNotFoundResponse = `${buyArguments.cryptoCurrencySymbol} on the network ${buyArguments.blockchainNetwork} is not supported at the moment.\n\nHere's a list of supported assets and networks:\n${getSupportedAssetAndNetworksText(
            {
                action: ExploreAssetActions.BUY_ASSET,
            }
        )}`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                assetNotFoundResponse
            )
        );
        return {
            response: assetNotFoundResponse,
            resetSession: false,
        };
    }

    if (!targetAsset.supportedAssetActions.includes(ExploreAssetActions.BUY_ASSET)) {
        const assetNotSupportedResponse = `Buying ${targetAsset.tokenName} on ${targetAsset.network} is not supported at the moment. Please try again with a supported asset.`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                assetNotSupportedResponse
            )
        );
        return {
            response: assetNotSupportedResponse,
            resetSession: false,
        };
    }

    await WhatsAppBotService.handleBuyAssetAction(
        user,
        {
            userPhoneNumber: botParams.userPhoneNumber,
            businessPhoneNumberId: botParams.businessPhoneNumberId,
        },
        targetAsset.listItemId,
        isAgent
    );

    return {
        response: 'Handled buy asset action',
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//       Swap Crypto Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleSwapCryptoPrompt = async (
    params: ActionHandlerParams,
    minimumAccessLevel: FeatureAccessLevel
): Promise<PromptHandlerResponse> => {
    const { extractedArguments, botParams, user } = params;

    const isEnabled = await FeatureFlagService.isFeatureEnabled(FeatureFlagKey.SWAPS);

    if (!isEnabled) {
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                SWAP_UNAVAILABLE_RESPONSE
            )
        );

        return {
            response: SWAP_UNAVAILABLE_RESPONSE,
            resetSession: true,
        };
    }

    const userAccessLevel = deriveUserFeatureAccessLevel(user.FEATURE_ACCESS_LEVEL);
    if (!canAccessFeature(userAccessLevel, minimumAccessLevel)) {
        const responseMessage =
            "The swapping feature is currently not available! You'll be the first to know when it's back up.";

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(botParams.userPhoneNumber, responseMessage)
        );

        return {
            response: responseMessage,
            resetSession: true,
        };
    }

    if (extractedArguments === null || Object.keys(extractedArguments).length === 0) {
        const missingArgsPromptResponse = getSwapArgumentsGuideMessage({
            fromCryptoCurrencySymbol: true,
            toCryptoCurrencySymbol: true,
            fromBlockchainNetwork: true,
            toBlockchainNetwork: true,
            amount: true,
        });

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                missingArgsPromptResponse
            )
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const swapArguments = parseExtractedArguments(
        extractedArguments,
        actionArgumentsSchema.SWAP_CRYPTO
    );

    if (
        !swapArguments.fromBlockchainNetwork ||
        !swapArguments.fromCryptoCurrencySymbol ||
        !swapArguments.toBlockchainNetwork ||
        !swapArguments.toCryptoCurrencySymbol ||
        swapArguments.fromAmount === null
    ) {
        const missingArgsPromptResponse = getSwapArgumentsGuideMessage({
            fromCryptoCurrencySymbol: !swapArguments.fromCryptoCurrencySymbol,
            toCryptoCurrencySymbol: !swapArguments.toCryptoCurrencySymbol,
            fromBlockchainNetwork: !swapArguments.fromBlockchainNetwork,
            toBlockchainNetwork: !swapArguments.toBlockchainNetwork,
            amount: swapArguments.fromAmount === null,
        });

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                missingArgsPromptResponse
            )
        );
        return {
            response: missingArgsPromptResponse,
            resetSession: false,
        };
    }

    const {
        fromCryptoCurrencySymbol,
        fromBlockchainNetwork,
        toCryptoCurrencySymbol,
        toBlockchainNetwork,
        fromAmount: rawFromAmount,
    } = swapArguments;

    if (
        fromCryptoCurrencySymbol.toLowerCase() === toCryptoCurrencySymbol.toLowerCase() &&
        fromBlockchainNetwork.toLowerCase() === toBlockchainNetwork.toLowerCase()
    ) {
        const responseMessage = 'Tokens to swap must be different';

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, responseMessage)
        );
        return {
            response: responseMessage,
            resetSession: false,
        };
    }

    if (!isValidBlockchain(fromBlockchainNetwork) || !isValidBlockchain(toBlockchainNetwork)) {
        const responseMessage = !isValidBlockchain(fromBlockchainNetwork)
            ? `${fromBlockchainNetwork} is not a supported blockchain network. Supported networks are: ${SUPPORTED_BLOCKCHAINS.join(', ')}`
            : `${toBlockchainNetwork} is not a supported blockchain network. Supported networks are: ${SUPPORTED_BLOCKCHAINS.join(', ')}`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, responseMessage)
        );
        return {
            response: responseMessage,
            resetSession: false,
        };
    }

    const typedFromBlockchainNetwork = normalizeBlockchainInput(fromBlockchainNetwork);
    const typedToBlockchainNetwork = normalizeBlockchainInput(toBlockchainNetwork);

    const [fromTokenConfig, toTokenConfig] = [
        azzaWalletManager.searchAssets({
            tokenName: fromCryptoCurrencySymbol,
            network: typedFromBlockchainNetwork,
        })[ZERO],
        azzaWalletManager.searchAssets({
            tokenName: toCryptoCurrencySymbol,
            network: typedToBlockchainNetwork,
        })[ZERO],
    ];

    if (!fromTokenConfig || !toTokenConfig) {
        const responseMessage = !fromTokenConfig
            ? `The token ${fromCryptoCurrencySymbol} on ${fromBlockchainNetwork} is not supported at the moment.\n\nHere's a list of supported assets and networks:\n${getSupportedAssetAndNetworksText()}`
            : `The token ${toCryptoCurrencySymbol} on ${toBlockchainNetwork} is not supported at the moment.\n\nHere's a list of supported assets and networks:\n${getSupportedAssetAndNetworksText()}`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, responseMessage)
        );

        return {
            response: responseMessage,
            resetSession: false,
        };
    }

    const fromAmount = clipDecimal(rawFromAmount, 9);

    if (fromAmount <= 0) {
        const invalidAmountResponse = `Amount to swap must be greater than 0`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                invalidAmountResponse
            )
        );

        return {
            response: invalidAmountResponse,
            resetSession: false,
        };
    }

    const fromTokenBalance = await azzaWalletManager.getAssetBalance({
        assetId: fromTokenConfig.listItemId,
        userId: user.id,
    });

    const [pendingFeeAggregate, transactionFee, hasExceededGaslessWithdrawalLimit] =
        await Promise.all([
            aggregatePendingTransactionFeeTokenAmount(user.id, fromTokenConfig.listItemId),
            calculateWithdrawalFees({
                amount: fromAmount,
                assetId: fromTokenConfig.listItemId,
                userId: user.id,
                recipient: getDefaultParamsForNetworkFeeQuery(fromTokenConfig.network).recipient,
            }),
            hasExceededLimit(user.id, 'GASLESS_TRANSACTIONS'),
        ]);

    const flatSwapFee = fromAmount * FLAT_SWAP_FEE;
    const totalFee = hasExceededGaslessWithdrawalLimit
        ? transactionFee.networkFee + flatSwapFee
        : flatSwapFee;

    if (totalFee > 0 && fromAmount <= totalFee) {
        const minAmountResponse = `Minimum swap amount is ${totalFee + fromAmount} ${fromTokenConfig.tokenName}`;
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                minAmountResponse
            )
        );
        return {
            response: minAmountResponse,
            resetSession: false,
        };
    }

    const availableBalance =
        fromTokenConfig.tokenName === 'SOL'
            ? fromTokenBalance.balance - pendingFeeAggregate - SOL_RENT_ESTIMATE
            : fromTokenBalance.balance - pendingFeeAggregate;

    if (availableBalance < fromAmount) {
        const insufficientBalanceResponse = `⚠️ Insufficient balance. The max you can swap is ${availableBalance} ${fromTokenConfig.tokenName}`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                insufficientBalanceResponse
            )
        );

        return {
            response: insufficientBalanceResponse,
            resetSession: false,
        };
    }

    if (!swapArguments.hasConfirmedSwap) {
        const response = `
        Let’s confirm the details of your swap:\n✔Asset to Swap From: ${fromCryptoCurrencySymbol}\n✔Asset to Swap To: ${toCryptoCurrencySymbol}\n✔Amount: ${fromAmount} ${fromCryptoCurrencySymbol}\n✔From Chain: ${fromBlockchainNetwork}\n✔To Chain: ${toBlockchainNetwork}\n\nReply "Yes" to confirm.\n\n_To edit any of the details, reply with something like "Swap 2 usdc instead" or "Swap to ETH instead"._`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, response)
        );

        return {
            response,
            resetSession: false,
        };
    }

    await WhatsAppBotService.sendWhatsappMessage(
        botParams.businessPhoneNumberId,
        MessageGenerators.generateTextMessage(
            botParams.userPhoneNumber,
            '⏺️ Getting a quote for your swap... Please wait.'
        )
    );

    const [toUserWallet] = await Promise.all([
        azzaWalletManager.getUserWallet(user.id, fromTokenConfig.network),
        azzaWalletManager.getUserWallet(user.id, toTokenConfig.network),
    ]);

    let quote: SwapAssetQuote | null = null;

    try {
        quote = await azzaWalletManager.getSwapQuote({
            amount: decimalToString(fromAmount),
            fromAssetId: fromTokenConfig.listItemId,
            toAssetId: toTokenConfig.listItemId,
            recipientAddress: toUserWallet.address,
            userId: user.id,
        });
    } catch (error) {
        await logServiceError(error, 'Error getting swap quotes');
    }

    if (!quote) {
        const responseMessage = `Swapping ${fromTokenConfig.tokenName} (${fromTokenConfig.network}) to ${toTokenConfig.tokenName} (${toTokenConfig.network}) is temporarily unavailable`;
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, responseMessage)
        );

        return {
            response: responseMessage,
            resetSession: false,
        };
    }

    const swapFee = totalFee;
    const toAmount = quote.rate * (fromAmount - swapFee);
    const prettifiedFromAmount = prettifyNumber(fromAmount, 6);
    const prettifiedToAmount = prettifyNumber(toAmount, 6);
    const swapRate = prettifyNumber(quote.rate, 6);
    const prettifiedSwapFee = prettifyNumber(swapFee, 6);
    const assetUsdConversionRate = transactionFee.networkFeeUsd / transactionFee.networkFee;
    const totalFeeUsd = assetUsdConversionRate * totalFee;

    const chainMessages =
        fromBlockchainNetwork === toBlockchainNetwork
            ? [`Chain: *${typedFromBlockchainNetwork}*`]
            : [
                `From Chain: *${typedFromBlockchainNetwork}*`,
                `To Chain: *${typedToBlockchainNetwork}*`,
            ];

    const transactionSummaryMessageBody = [
        `🔄 _Swap_ *_${fromTokenConfig.tokenName}_* to *_${toTokenConfig.tokenName}_*\n`,
        `From Amount: *${prettifiedFromAmount} ${fromTokenConfig.tokenName}*`,
        `To Amount: *${prettifiedToAmount} ${toTokenConfig.tokenName}*\n`,
        `1 *${fromTokenConfig.tokenName}* = ${swapRate} *${toTokenConfig.tokenName}*`,
        swapFee > 0 ? `Fee: *${prettifiedSwapFee} ${fromTokenConfig.tokenName}*\n` : '',
        ...chainMessages,
        `\n_Estimated Time: *${quote.estimatedArrivalTime}s*_`,
    ]
        .filter((value) => value.trim() !== '')
        .join('\n');

    const transactionSummaryMessage =
        WhatsAppBotTransactionConfirmationFlowService.withPhoneNumberId(
            botParams.businessPhoneNumberId as PhoneNumberId
        ).createTransactionConfirmationFlowMessage({
            msgRecipient: botParams.userPhoneNumber,
            transactionSummary: transactionSummaryMessageBody
                .replaceAll('_', '')
                .replaceAll('*', ''),
            transactionMessageBody: `${transactionSummaryMessageBody}\n\nClick on "Confirm Transaction" to enter your transaction PIN and complete your transaction.`,
            transactionDetails: {
                transactionType: 'SWAP_TOKENS',
                userId: convertAsciiStringToBase64(user.id),
                fromTokenId: fromTokenConfig.listItemId,
                toTokenId: toTokenConfig.listItemId,
                fromAmount: fromAmount,
                transactionFee: swapFee,
                rate: quote.rate,
                recipientAddress: toUserWallet.address,
                toAmount: toAmount,
                transactionFeeUsd: totalFeeUsd,
            },
        });

    await WhatsAppBotService.sendWhatsappMessage(
        botParams.businessPhoneNumberId,
        transactionSummaryMessage
    );

    return {
        response: transactionSummaryMessage.interactive.body.text,
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//       Rates Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleRatesPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { botParams } = params;

    await WhatsAppBotService.ratesCommandHandler(
        botParams.userPhoneNumber,
        botParams.businessPhoneNumberId
    );

    return {
        response: 'Handled rates prompt',
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//       KYC Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleKycPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { botParams, user } = params;

    const userKycStatus = userServiceV2.formatKycStatus(user.kycStatus);

    if (userKycStatus === 'verified') {
        const responseMessage = `Your KYC is already verified.`;
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(botParams.userPhoneNumber, responseMessage)
        );

        return {
            response: 'Handled KYC prompt',
            resetSession: true,
        };
    }

    if (SumSubService.SERVICE_IS_ACTIVE) {
        if (
            userKycStatus === 'unverified' ||
            userKycStatus === 'rejected' ||
            userKycStatus === 'pending'
        ) {
            await WhatsAppBotService.sendKycVerificationUrlMessage(user, botParams);
            return {
                response: 'Handled KYC prompt',
                resetSession: true,
            };
        }

        if (userKycStatus === 'in_review') {
            await WhatsAppBotService.sendKycInReviewMessage(botParams);
            return {
                response: 'Handled KYC prompt',
                resetSession: true,
            };
        }
    }

    const responseMessage = `KYC verification is not available at the moment.`;
    await WhatsAppBotService.sendWhatsappMessage(
        botParams.businessPhoneNumberId,
        MessageGenerators.generateTextMessage(botParams.userPhoneNumber, responseMessage)
    );

    return {
        response: 'Handled KYC prompt',
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//       Referral Prompt Handler
/////////////////////////////////////////////////////////
export const handleReferralPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    await addJobToReferralCodeQueue({
        userId: params.user.id,
        whatsappParams: params.botParams,
        displayName: params.botParams.waDisplayName,
    });

    return {
        response: 'Handled Referral prompt',
        resetSession: true,
    };
};


/////////////////////////////////////////////////////////
//       Agent Earning Prompt Handler
/////////////////////////////////////////////////////////
export const handleAgentEarningPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {

    await P2pAgentService.getP2pAgentAccountSummary(
        params.user.id,
        {
            userPhoneNumber: params.botParams.userPhoneNumber,
            businessPhoneNumberId: params.botParams.businessPhoneNumberId
        }
    );

    return {
        response: 'Handled P2p agent earning prompt',
        resetSession: true,
    };
};


/////////////////////////////////////////////////////////
//       Pay Prompt Handler
/////////////////////////////////////////////////////////
export const handlePayRelatedPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const response = await handlePayPrompt({
        whatsappParams: params.botParams,
        user: params.user,
        args: params.extractedArguments
            ? parseExtractedArguments(
                params.extractedArguments,
                actionArgumentsSchema.PAY_TO_BANK_ACCOUNT
            )
            : null,
    });

    if (response.botResponseMessage) {
        await WhatsAppBotService.sendWhatsappMessage(
            params.botParams.businessPhoneNumberId,
            response.botResponseMessage
        );
    }

    return {
        response: response.rawText,
        resetSession: response.resetSession,
    };
};

/////////////////////////////////////////////////////////
//       Support Prompt Handler
/////////////////////////////////////////////////////////
export const handleSupportRelatedPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const responseMessage = getSupportContactsMessageText();

    const { botParams } = params;
    await WhatsAppBotService.sendWhatsappMessage(
        botParams.businessPhoneNumberId,
        MessageGenerators.generateTextMessage(botParams.userPhoneNumber, responseMessage)
    );
    return {
        response: responseMessage,
        resetSession: true,
    };
};


/////////////////////////////////////////////////////////
//       Account Statement Prompt Handler
/////////////////////////////////////////////////////////
export const handleAccountStatementRelatedPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {

    const { botParams, user, } = params;

    await WhatsAppBotService.beginAccountStatementFlowMessage(
        user,
        { userPhoneNumber: botParams.userPhoneNumber, businessPhoneNumberId: botParams.businessPhoneNumberId }
    );

    return {
        response: 'Handled account statement prompt',
        resetSession: true,
    };
};


/////////////////////////////////////////////////////////
//       Airtime Prompt Handler
/////////////////////////////////////////////////////////
export const handleAirtimePurchasePrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {

    const { botParams, user, } = params;

    await WhatsAppBotService.beginNgnAirtimeFlowMessage(
        user,
        { userPhoneNumber: botParams.userPhoneNumber, businessPhoneNumberId: botParams.businessPhoneNumberId }
    );

    return {
        response: 'Handled account statement prompt',
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//       Airtime Prompt Handler
/////////////////////////////////////////////////////////
export const handleDataBundlePurchasePrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {

    const { botParams, user, } = params;

    await WhatsAppBotService.beginNgnDataBundleFlowMessage(
        user,
        { userPhoneNumber: botParams.userPhoneNumber, businessPhoneNumberId: botParams.businessPhoneNumberId }
    );

    return {
        response: 'Handled account statement prompt',
        resetSession: true,
    };
};

/////////////////////////////////////////////////////////
//                   Helper Functions
/////////////////////////////////////////////////////////
function parseExtractedArguments<T extends ZodSchema>(
    extractedArguments: z.infer<T> | null | Record<string, unknown> | undefined,
    schema: T
): z.infer<T> {
    return schema.parse(extractedArguments);
}

function getAssetChoiceMessage(action: 'deposit' | 'buy') {
    return `
    Tell me what asset you want to ${action} and the chain it’s on.\n\nExample: “USDC on Solana”\n\n*Supported Assets and Chains:*\n${action === 'buy'
            ? getSupportedAssetAndNetworksText({
                action: ExploreAssetActions.BUY_ASSET,
            })
            : getSupportedAssetAndNetworksText()
        }`;
}

function getWithdrawalArgumentsGuideMessage(missingParams: {
    amount?: boolean;
    recipientAddressOrPhoneNumber?: boolean;
    blockchainNetwork?: boolean;
    cryptoCurrencySymbol?: boolean;
}) {
    const assetLine = '✔Asset – What do you want to withdraw? (e.g., USDT, USDC, ETH)';
    const chainLine = '✔Chain – Which chain should we use? (e.g., Base, Ethereum, Solana)';
    const amountLine = '✔Amount – How much do you want to withdraw?';
    const recipientLine =
        '✔Recipient Address or Phone Number – Where should we send it? (For phone numbers, include the country code and ensure it’s registered on AZZA.)';

    let missingParamsText = '';

    if (missingParams.cryptoCurrencySymbol) {
        missingParamsText += assetLine + '\n';
    }
    if (missingParams.blockchainNetwork) {
        missingParamsText += chainLine + '\n';
    }
    if (missingParams.amount) {
        missingParamsText += amountLine + '\n';
    }
    if (missingParams.recipientAddressOrPhoneNumber) {
        missingParamsText += recipientLine + '\n';
    }

    return `I’ll need a few details to process your withdrawal:\n${missingParamsText}\nExample:\n- 50 USDT on Ethereum to 0x45.....[Recipient Address].\n- 50 USDT on Ethereum to 234703....[Phone Number].`;
}

function getSellCryptoArgumentsGuideMessage(missingParams: {
    blockchainNetwork?: boolean;
    cryptoCurrencySymbol?: boolean;
}) {
    const assetLine = '✔Asset – Which cryptocurrency would you like to sell? (e.g., USDT, USDC)';
    const chainLine = '✔Chain – Which blockchain should it be on? (e.g., Solana, Base, BSC)';

    let missingParamsText = '';

    if (missingParams.cryptoCurrencySymbol) {
        missingParamsText += assetLine + '\n';
    }
    if (missingParams.blockchainNetwork) {
        missingParamsText += chainLine + '\n';
    }

    return `I’ll need a few details to assist you:\n${missingParamsText}\nExample: “USDC on Solana”\n\nOnce I have this info, I’ll guide you through the next steps! 🚀`;
}

function getSwapArgumentsGuideMessage(missingParams: {
    amount?: boolean;
    fromCryptoCurrencySymbol?: boolean;
    fromBlockchainNetwork?: boolean;
    toBlockchainNetwork?: boolean;
    toCryptoCurrencySymbol?: boolean;
}) {
    const fromAssetLine = '✔Asset to Swap From – What do you want to swap? (e.g., USDT)';
    const toAssetLine = '✔Asset to Swap To – What do you want to receive? (e.g., ETH)';
    const fromChainLine = '✔From Chain – On which network is the asset? (e.g., Ethereum, Solana)';
    const toChainLine = '✔To Chain – Which chain should we swap to? (e.g., Ethereum, Solana)';
    const amountLine = '✔Amount – How much do you want to swap?';

    let missingParamsText = '';

    if (missingParams.fromCryptoCurrencySymbol) {
        missingParamsText += fromAssetLine + '\n';
    }
    if (missingParams.toCryptoCurrencySymbol) {
        missingParamsText += toAssetLine + '\n';
    }
    if (missingParams.fromBlockchainNetwork) {
        missingParamsText += fromChainLine + '\n';
    }
    if (missingParams.toBlockchainNetwork) {
        missingParamsText += toChainLine + '\n';
    }
    if (missingParams.amount) {
        missingParamsText += amountLine + '\n';
    }

    return `Tell me the details of the swap:\n${missingParamsText}\nExample: “Swap 100 USDT on Ethereum to ETH.”`;
}
