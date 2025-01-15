import { AssetTransferRecipientType } from '@/app/azza/azza.schema';
import { AssetBalance } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import { getDefaultSolanaNode, getSolanaNetworkClient } from '@/app/ExtendedWallet/solana/config';
import ExtendedSolanaWalletLibrary from '@/app/ExtendedWallet/solana/ExtendedSolanaWalletLibrary';
import LiFiIntegrationLibrary from '@/app/LiFi/LiFiIntegrationLibrary';
import { Action } from '@/app/llmCallRouter/inputClassifier';
import userServiceV2 from '@/app/runtime/user';
import azzaWalletManager from '@/app/runtime/wallet';
import UserService from '@/app/User/UserService';
import WalletAssetManagementService from '@/app/WalletAssetManagement/WalletAssetManagementService';
import Web3Library from '@/app/WalletAssetManagement/Web3Library';
import { SUPPORTED_CHAINS, SupportedChain } from '@/app/WalletKit/walletKitSchema';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import { actionArgumentsSchema } from '@/app/WhatsAppBot/text/classifiedActionSchema';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { ExploreAssetActions, PhoneNumberParams } from '@/app/WhatsAppBot/WhatsAppBotType';
import { PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import WhatsAppBotChangeTransactionPinFlowService
    from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotChangeTransactionPinFlowService';
import WhatsAppBotResetTransactionPinFlowService
    from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotResetTransactionPinFlowService';
import WhatsAppBotTransactionConfirmationFlowService
    from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransactionConfirmationFlowService';
import { canAccessFeature, deriveUserFeatureAccessLevel, FeatureAccessLevel } from '@/config/whatsAppBot';
import env from '@/constants/env';
import { SIX, ZERO } from '@/constants/numbers';
import { USD_SYMBOL } from '@/constants/strings';
import { UserV2Record } from '@/db/xata';
import { getNetworkEmoji } from '@/resources/utils/bot-message-utils';
import { getUserCountryCodeFromPhoneNumberOrThrow, prettifyNumber } from '@/resources/utils/currency';
import { convertAsciiStringToBase64 } from '@/resources/utils/encryption';
import { cleanPhoneNumberInput } from '@/resources/utils/phone-numbers';
import { validateWalletAddress } from '@/resources/utils/validators';
import { getAppDefaultEvmConfig } from '@/resources/web3/evm/evm.config';
import { getPublicClient } from '@/resources/web3/evm/viem/clients';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { formatUnits, getAddress, parseUnits } from 'viem';
import { z, ZodSchema } from 'zod';
import { getSupportedAssetAndNetworksText } from '../utils';

type ActionHandlerParams = {
    extractedArguments:
        | z.infer<(typeof actionArgumentsSchema)[Exclude<Action['class'], 'NO_PREDEFINED_ACTION'>]>
        | null
        | Record<string, unknown>;
    botParams: PhoneNumberParams;
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
        network: depositArguments.blockchainNetwork as SupportedChain,
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
        network: withdrawArguments.blockchainNetwork as SupportedChain,
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

    const balanceInfo = await azzaWalletManager.getAssetBalance({
        userId: user.id,
        assetId: targetAsset.listItemId,
    });

    if (balanceInfo.balance < withdrawArguments.amount) {
        const insufficientBalanceResponse = `Insufficient balance. You have ${balanceInfo.balance} ${targetAsset.tokenName}`;

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

    const transactionFee = WalletAssetManagementService.calculateStableTokenTransferTransactionFee(
        withdrawArguments.amount.toString(),
        targetAsset.network
    );
    const totalAmount = withdrawArguments.amount + transactionFee;

    if (balanceInfo.balance < totalAmount) {
        const amountDeficit = totalAmount - balanceInfo.balance;
        const notEnoughBalanceResponse = `You need extra ${amountDeficit} ${targetAsset.tokenName} on ${targetAsset.network} to cover for transaction fee`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                params.botParams.userPhoneNumber,
                notEnoughBalanceResponse
            )
        );

        return {
            response: notEnoughBalanceResponse,
            resetSession: false,
        };
    }

    const transactionSummaryMessage = `Please confirm the transfer details:\n\n- Cryptocurrency: ${targetAsset.tokenName}\n- Amount: ${withdrawArguments.amount} ${targetAsset.tokenName}\n- Recipient: ${recipient}\n- Chain: ${targetAsset.network}\n\nReply "Yes" to confirm.\n\n_To edit any of the details, reply with the correct details. E.g: "Withdraw 2 usdc instead" or "Withdraw on Ethereum"_`;

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
            amount: withdrawArguments.amount,
            assetId: targetAsset.listItemId,
            transactionFee,
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
                  network: blockchainNetwork as SupportedChain,
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
                entity: blockchainNetwork,
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
        case 'asset on specific network':
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

        case 'asset on any network':
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

        case 'network':
            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.botParams.userPhoneNumber,
                    `*Checking balance on ${balanceQueryMode.entity}...*`
                )
            );
            const targetAssetIds = supportedAssets
                .filter((asset) => {
                    // filter for assetName | network or assetName && network
                    return asset.network.toLowerCase() === balanceQueryMode.entity.toLowerCase();
                })
                .map((asset) => asset.listItemId);

            const promises = targetAssetIds.map((assetId) =>
                azzaWalletManager.getAssetBalance({
                    userId: user.id,
                    assetId,
                })
            );

            const assetsInfo = await Promise.all(promises);
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

            const networkBalanceMessage = `*Your balances on ${getNetworkEmoji(balanceQueryMode.entity as SupportedChain)} ${balanceQueryMode.entity}:*\n\n${networkBalances.join('\n\n')}`;

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

        case 'all':
            await WhatsAppBotService.sendWhatsappMessage(
                botParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    params.botParams.userPhoneNumber,
                    `Checking balance on all networks...`
                )
            );

            const allAssetIds = supportedAssets.map((asset) => asset.listItemId);
            const allPromises = allAssetIds.map((assetId) =>
                azzaWalletManager.getAssetBalance({
                    userId: user.id,
                    assetId,
                })
            );

            const allAssetsInfo = await Promise.all(allPromises);
            // group the assets by network
            const groupedAssets = allAssetsInfo.reduce(
                (acc, assetInfo) => {
                    const network = assetInfo.blockchainNetwork;
                    if (!acc[network]) {
                        acc[network] = [];
                    }
                    acc[network].push({
                        ...assetInfo,
                        networkEmoji: getNetworkEmoji(network),
                    });
                    return acc;
                },
                {} as Record<
                    string,
                    Array<
                        AssetBalance & {
                            networkEmoji: string;
                        }
                    >
                >
            );

            const networkBalancesMessage = Object.entries(groupedAssets)
                .map(([network, assets]) => {
                    const assetBalances = assets
                        .map((asset) => {
                            const tokenBalanceDisplay = prettifyNumber(asset.balance, 6);
                            const usdBalanceDisplay =
                                asset.convertedBalanceUsd !== undefined
                                    ? prettifyNumber(asset.convertedBalanceUsd, SIX)
                                    : null;

                            return `- ${tokenBalanceDisplay} ${asset.asset.tokenName}${usdBalanceDisplay ? ` (${USD_SYMBOL}${usdBalanceDisplay})` : ''}`;
                        })
                        .join('\n');
                    return `*${getNetworkEmoji(network as SupportedChain)} ${network}*\n${assetBalances}`;
                })
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
        network: buyArguments.blockchainNetwork as SupportedChain,
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
        targetAsset.listItemId
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
        network: sellArguments.blockchainNetwork as SupportedChain,
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
//       Swap Crypto Related Prompt Handler
/////////////////////////////////////////////////////////
export const handleSwapCryptoPrompt = async (
    params: ActionHandlerParams
): Promise<PromptHandlerResponse> => {
    const { extractedArguments, botParams, user } = params;

    const userAccessLevel = deriveUserFeatureAccessLevel(user.FEATURE_ACCESS_LEVEL);
    if (!canAccessFeature(userAccessLevel, FeatureAccessLevel.STAGING)) {
        const responseMessage =
            "'The swapping feature is currently not available! You\'ll be the first to know when it\'s back up.'

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(botParams.userPhoneNumber, responseMessage),
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
        fromAmount,
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

    const typedFromBlockchainNetwork = SUPPORTED_CHAINS.find(
        (chain) => chain.toLowerCase() === fromBlockchainNetwork.toLowerCase()
    );
    const typedToBlockchainNetwork = SUPPORTED_CHAINS.find(
        (chain) => chain.toLowerCase() === toBlockchainNetwork.toLowerCase()
    );

    if (!typedFromBlockchainNetwork || !typedToBlockchainNetwork) {
        const responseMessage = !typedFromBlockchainNetwork
            ? `${fromBlockchainNetwork} is not a supported blockchain network. Supported networks are: ${SUPPORTED_CHAINS.join(', ')}`
            : `${toBlockchainNetwork} is not a supported blockchain network. Supported networks are: ${SUPPORTED_CHAINS.join(', ')}`;

        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, responseMessage)
        );
        return {
            response: responseMessage,
            resetSession: false,
        };
    }

    if (!LiFiIntegrationLibrary.isSupportedChain(typedFromBlockchainNetwork)) {
        const responseMessage = `Swaps from ${fromBlockchainNetwork} are not supported at the moment.`;
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, responseMessage)
        );

        return {
            response: responseMessage,
            resetSession: false,
        };
    }

    if (!LiFiIntegrationLibrary.isSupportedChain(typedToBlockchainNetwork)) {
        const responseMessage = `Swaps to ${toBlockchainNetwork} are not supported at the moment.`;
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, responseMessage)
        );

        return {
            response: responseMessage,
            resetSession: false,
        };
    }

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

    const [fromUserWallet, toUserWallet] = await Promise.all([
        UserService.getUserAssetWalletOrThrow(
            botParams.userPhoneNumber,
            fromTokenConfig.listItemId
        ),
        UserService.getUserAssetWalletOrThrow(botParams.userPhoneNumber, toTokenConfig.listItemId),
    ]);

    const formattedAmount =
        typedFromBlockchainNetwork === 'Solana'
            ? await (async () => {
                  if (
                      !validateWalletAddress(
                          fromTokenConfig.tokenAddress,
                          typedFromBlockchainNetwork
                      )
                  ) {
                      return BigInt(fromAmount * LAMPORTS_PER_SOL).toString();
                  }
                  const connection = getSolanaNetworkClient(getDefaultSolanaNode());
                  const decimals = await ExtendedSolanaWalletLibrary.getTokenDecimals(
                      connection,
                      new PublicKey(fromTokenConfig.tokenAddress)
                  );

                  return parseUnits(`${fromAmount}`, decimals).toString();
              })()
            : await (async () => {
                  let decimals: number;
                  const networkConfig = getAppDefaultEvmConfig(
                      typedFromBlockchainNetwork,
                      env.WEB3_ENVIRONMENT
                  );

                  if (
                      !validateWalletAddress(
                          fromTokenConfig.tokenAddress,
                          typedFromBlockchainNetwork
                      )
                  ) {
                      decimals = networkConfig.viemChain.nativeCurrency.decimals;
                  } else {
                      const publicClient = getPublicClient(
                          networkConfig.viemChain,
                          networkConfig.rpcUrl
                      );
                      decimals = await Web3Library.getTokenDecimals(
                          publicClient,
                          getAddress(fromTokenConfig.tokenAddress)
                      );
                  }

                  return parseUnits(`${fromAmount}`, decimals).toString();
              })();

    const [fromChainKey, toChainKey] = [
        LiFiIntegrationLibrary.getChainKey(typedFromBlockchainNetwork),
        LiFiIntegrationLibrary.getChainKey(typedToBlockchainNetwork),
    ];

    const quote = await LiFiIntegrationLibrary.getQuote({
        fromToken: fromTokenConfig.tokenAddress,
        fromAmount: formattedAmount,
        fromAddress: fromUserWallet.walletAddress,
        toToken: toTokenConfig.tokenAddress,
        fromChain: fromChainKey,
        toChain: toChainKey,
        toAddress: toUserWallet.walletAddress,
    });

    const quote_fromToken = quote.action.fromToken;
    const quote_toToken = quote.action.toToken;
    const slippage = quote.action.slippage;
    const quoteEstimate = quote.estimate;
    const transactionRequest = quote.transactionRequest;

    if (!transactionRequest) {
        const responseMessage = 'An error occurred while trying to get a quote for your swap.';
        await WhatsAppBotService.sendWhatsappMessage(
            botParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.botParams.userPhoneNumber, responseMessage)
        );

        return {
            response: responseMessage,
            resetSession: false,
        };
    }

    const formattedFromAmount = formatUnits(
        BigInt(quoteEstimate.fromAmount),
        quote_fromToken.decimals
    );
    const formattedToAmount = formatUnits(BigInt(quoteEstimate.toAmount), quote_toToken.decimals);

    const [prettifiedFromAmount, prettifiedToAmount] = [
        prettifyNumber(Number(formattedFromAmount), 6),
        prettifyNumber(Number(formattedToAmount), 6),
    ];

    const swapRate = prettifyNumber(Number(formattedToAmount) / Number(formattedFromAmount), 6);

    const chainMessages =
        fromBlockchainNetwork === toBlockchainNetwork
            ? [`Chain: *${typedFromBlockchainNetwork}*`]
            : [
                  `From Chain: *${typedFromBlockchainNetwork}*`,
                  `To Chain: *${typedToBlockchainNetwork}*`,
              ];

    const transactionSummaryMessageBody = [
        `🔄 _Swap_ *_${quote_fromToken.symbol}_* to *_${quote_toToken.symbol}_*\n`,
        `From Amount: *${prettifiedFromAmount} ${quote_fromToken.symbol}*`,
        `To Amount: *${prettifiedToAmount} ${quote_toToken.symbol}*`,
        `1 ${quote_fromToken.symbol} = ${swapRate} ${quote_toToken.symbol}\n`,
        ...chainMessages,
        `Slippage: *${slippage * 100}%*`,
    ].join('\n');

    const transactionSummaryMessage =
        WhatsAppBotTransactionConfirmationFlowService.withPhoneNumberId(
            botParams.businessPhoneNumberId as PhoneNumberId
        ).createTransactionConfirmationFlowMessage({
            msgRecipient: botParams.userPhoneNumber,
            transactionSummary: transactionSummaryMessageBody
                .replaceAll('_', '')
                .replaceAll('*', ''),
            transactionMessageBody: `${transactionSummaryMessageBody}\n\nClick on the button below to enter your transaction PIN and complete your transaction.`,
            transactionDetails: {
                transactionType: 'SWAP_TOKENS',
                userId: convertAsciiStringToBase64(botParams.userPhoneNumber),
                fromToken: {
                    name: quote_fromToken.name,
                    symbol: quote_fromToken.symbol,
                    id: quote_fromToken.address,
                    decimals: quote_fromToken.decimals,
                },
                toToken: {
                    name: quote_toToken.name,
                    symbol: quote_toToken.symbol,
                    id: quote_toToken.address,
                    decimals: quote_toToken.decimals,
                },
                fromAmount: quoteEstimate.fromAmount,
                transactionRequest: transactionRequest,
                approvalAddress: quote.estimate.approvalAddress,
                fromChain: typedFromBlockchainNetwork,
                toChain: typedToBlockchainNetwork,
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
        response: 'Handled rates command',
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
    Tell me what asset you want to ${action} and the chain it’s on.\n\nExample: “USDC on Base”\n\n*Supported Assets and Chains:*\n${
        action === 'buy'
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
    const chainLine = '✔Chain – Which blockchain should it be on? (e.g., Base, Ethereum, Solana)';

    let missingParamsText = '';

    if (missingParams.cryptoCurrencySymbol) {
        missingParamsText += assetLine + '\n';
    }
    if (missingParams.blockchainNetwork) {
        missingParamsText += chainLine + '\n';
    }

    return `I’ll need a few details to assist you:\n${missingParamsText}\nExample: “USDC on Base”\n\nOnce I have this info, I’ll guide you through the next steps! 🚀`;
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
