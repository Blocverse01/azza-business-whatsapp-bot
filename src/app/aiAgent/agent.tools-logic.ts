import {
    BaseWalletToolParams,
    DepositCryptoAssetParams,
    RequestTransactionPinSetupParams,
    supportedTokenSymbolsForBaseSwap,
    SwapTokensOnBaseParams,
    SwapTokensParams,
    TransferCryptoAssetParams,
    WalletBalanceParams,
} from '@/app/aiAgent/agent.schema';
import { getDefaultSolanaNode, getSolanaNetworkClient } from '@/app/ExtendedWallet/solana/config';
import ExtendedSolanaWalletLibrary from '@/app/ExtendedWallet/solana/ExtendedSolanaWalletLibrary';
import LiFiIntegrationLibrary from '@/app/LiFi/LiFiIntegrationLibrary';
import Web3Library from '@/app/WalletAssetManagement/Web3Library';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import { PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import WhatsAppBotChangeTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotChangeTransactionPinFlowService';
import WhatsAppBotResetTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotResetTransactionPinFlowService';
import WhatsAppBotSetupTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotSetupTransactionPinFlowService';
import { ZERO } from '@/constants/numbers';
import { getNetworkEmoji } from '@/resources/utils/bot-message-utils';
import { convertBase64ToAsciiString } from '@/resources/utils/encryption';
import { ENABLED_ASSETS, getAssetConfigByTokenAddress, searchAsset } from '@/config/whatsAppBot';
import UserService from '@/app/User/UserService';
import { validateWalletAddress } from '@/resources/utils/validators';
import { cleanPhoneNumberInput } from '@/resources/utils/phone-numbers';
import WalletAssetManagementService from '@/app/WalletAssetManagement/WalletAssetManagementService';
import { UserAssetInfo } from '@/app/User/userSchema';
import {
    getUserCountryCodeFromPhoneNumberOrThrow,
    prettifyNumber,
} from '@/resources/utils/currency';
import WhatsAppBotTransactionConfirmationFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransactionConfirmationFlowService';
import env from '@/constants/env';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { AssetTransferRecipientType, TokenMetadata } from '@/app/azza/azza.schema';
import { getAppDefaultEvmConfig } from '@/resources/web3/evm/evm.config';
import { getPublicClient } from '@/resources/web3/evm/viem/clients';
import { TokenNames } from '@/resources/web3/tokens';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { formatUnits, getAddress, isAddress, parseUnits } from 'viem';

export const executeTransferAsset = async (params: TransferCryptoAssetParams) => {
    const { cryptoCurrencySymbol, recipient, amount, blockchainNetwork, userId } = params;

    const targetAsset = searchAsset({
        tokenName: cryptoCurrencySymbol,
        network: blockchainNetwork,
    })[ZERO];

    if (!targetAsset) {
        return {
            error: `Asset with symbol ${cryptoCurrencySymbol} on network ${blockchainNetwork} not found`,
        };
    }

    if (!recipient) {
        return {
            error: 'Recipient wallet address or phone number is required',
        };
    }

    const unmaskedUserIdentifier = convertBase64ToAsciiString(userId);

    const assetInfo = await UserService.getUserAssetInfo(
        unmaskedUserIdentifier,
        targetAsset.listItemId
    );
    if (assetInfo.tokenBalance < amount) {
        return {
            error: `Insufficient balance. You have ${assetInfo.tokenBalance} ${cryptoCurrencySymbol}`,
        };
    }

    const isPhoneNumber =
        !validateWalletAddress(recipient, targetAsset.network) &&
        Boolean(cleanPhoneNumberInput(recipient).match(/^\d+$/));
    if (isPhoneNumber) {
        try {
            getUserCountryCodeFromPhoneNumberOrThrow(recipient);
        } catch (error) {
            return {
                error: `The phone number '${recipient}' should be in the international format, e.g 2348031234567`,
            };
        }
    }
    if (!isPhoneNumber && !validateWalletAddress(recipient, targetAsset.network)) {
        return {
            error: `${recipient} is not a valid wallet address for ${targetAsset.network}`,
        };
    }

    const recipientType: AssetTransferRecipientType = isPhoneNumber
        ? AssetTransferRecipientType.PHONE_NUMBER
        : AssetTransferRecipientType.WALLET_ADDRESS;

    const transactionFee = WalletAssetManagementService.calculateStableTokenTransferTransactionFee(
        amount.toString(),
        targetAsset.network
    );
    const totalAmount = amount + transactionFee;

    if (assetInfo.tokenBalance < totalAmount) {
        const amountDeficit = totalAmount - assetInfo.tokenBalance;

        return {
            error: `You need extra ${amountDeficit} ${targetAsset.tokenName} on ${targetAsset.network} to cover for transaction fee`,
            transactionAmount: amount,
            transactionFee,
            availableBalance: assetInfo.tokenBalance,
            amountDeficit,
        };
    }

    const message = WhatsAppBotTransactionConfirmationFlowService.withPhoneNumberId(
        env.WA_PHONE_NUMBER_ID
    ).createTransactionConfirmationFlowMessage({
        transactionSummary: `Send ${amount} ${targetAsset.tokenName} to ${recipient}`,
        transactionMessageBody: `Click on 'Confirm Transaction' to confirm sending ${amount} ${targetAsset.tokenName} to ${recipient}`,
        msgRecipient: unmaskedUserIdentifier,
        transactionDetails: {
            transactionType: 'SEND',
            recipient,
            recipientType,
            amount,
            assetId: targetAsset.listItemId,
            transactionFee,
            userId: userId,
        },
    });

    await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

    return {
        nextStep:
            'Please click on the `Confirm Transaction` button above to confirm the transaction with your PIN',
        transactionAmount: amount,
        transactionFee,
        totalAmount,
        recipientType,
    };
};

export const executeWalletBalanceQuery = async (params: WalletBalanceParams) => {
    const { cryptoCurrencySymbol, blockchainNetwork, userId } = params;
    const unmaskedUserIdentifier = convertBase64ToAsciiString(userId);

    const targetAsset =
        cryptoCurrencySymbol && blockchainNetwork
            ? searchAsset({
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

    switch (balanceQueryMode.type) {
        case 'asset on specific network':
            const assetInfo = await UserService.getUserAssetInfo(
                unmaskedUserIdentifier,
                balanceQueryMode.entity.listItemId
            );

            const { extendedWallet: _extendedWallet, ...otherInfo } = assetInfo;

            return {
                balance: otherInfo,
                asset: balanceQueryMode.entity,
                networkEmoji: getNetworkEmoji(assetInfo.assetNetwork),
            };

        case 'asset on any network':
            const assetIds = ENABLED_ASSETS.filter((asset) => {
                return asset.tokenName.toLowerCase() === balanceQueryMode.entity.toLowerCase();
            }).map((asset) => asset.listItemId);

            const casePromises = assetIds.map((assetId) =>
                UserService.getUserAssetInfo(unmaskedUserIdentifier, assetId)
            );

            const _assetsInfo = await Promise.all(casePromises);
            const assetBalances = Object.fromEntries(
                _assetsInfo.map((assetInfo) => {
                    const { extendedWallet: _extendedWallet, ...otherInfo } = assetInfo;

                    return [
                        assetInfo.assetNetwork,
                        { ...otherInfo, networkEmoji: getNetworkEmoji(assetInfo.assetNetwork) },
                    ];
                })
            );

            return {
                balances: assetBalances,
                asset: balanceQueryMode.entity,
            };

        case 'network':
            const targetAssetIds = ENABLED_ASSETS.filter((asset) => {
                // filter for assetName | network or assetName && network
                return asset.network.toLowerCase() === balanceQueryMode.entity.toLowerCase();
            }).map((asset) => asset.listItemId);

            const promises = targetAssetIds.map((assetId) =>
                UserService.getUserAssetInfo(unmaskedUserIdentifier, assetId)
            );

            const assetsInfo = await Promise.all(promises);
            const balances = Object.fromEntries(
                assetsInfo.map((assetInfo) => {
                    const { extendedWallet: _extendedWallet, ...otherInfo } = assetInfo;
                    return [assetInfo.assetName, otherInfo];
                })
            );

            return {
                balances,
                network: balanceQueryMode.entity,
                networkEmoji: getNetworkEmoji(balanceQueryMode.entity),
            };

        case 'all':
            const allAssetIds = ENABLED_ASSETS.map((asset) => asset.listItemId);
            const allPromises = allAssetIds.map((assetId) =>
                UserService.getUserAssetInfo(unmaskedUserIdentifier, assetId)
            );

            const allAssetsInfo = await Promise.all(allPromises);
            // group the assets by network
            const groupedAssets = allAssetsInfo.reduce(
                (acc, assetInfo) => {
                    const { extendedWallet: _extendedWallet, ...otherInfo } = assetInfo;
                    const network = otherInfo.assetNetwork;
                    if (!acc[network]) {
                        acc[network] = [];
                    }
                    acc[network].push({
                        ...otherInfo,
                        networkEmoji: getNetworkEmoji(network),
                    });
                    return acc;
                },
                {} as Record<
                    string,
                    Array<
                        UserAssetInfo & {
                            networkEmoji: string;
                        }
                    >
                >
            );

            return {
                balances: groupedAssets,
            };
    }
};

export const executeRequestTransactionPinSetup = async (
    params: RequestTransactionPinSetupParams
) => {
    const { userId } = params;
    const unmaskedUserIdentifier = convertBase64ToAsciiString(userId);

    const user = await UserService.getUserByPhoneNumber(unmaskedUserIdentifier);

    if (user?.transactionPinHash) {
        return {
            message: 'Transaction pin already set',
        };
    }

    const message = WhatsAppBotSetupTransactionPinFlowService.withPhoneNumberId(
        env.WA_PHONE_NUMBER_ID
    ).createSetupTransactionPinFlowMessage({
        messageRecipient: unmaskedUserIdentifier,
        messageBody:
            'Please click on the `Set up Transaction PIN` button to set up your transaction PIN',
    });

    await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

    return {
        nextStep:
            'Please click on the `Set up Transaction PIN` button above to set up your transaction PIN',
    };
};

export const executeDepositCryptoAsset = async (params: DepositCryptoAssetParams) => {
    const { userId, blockchainNetwork, cryptoCurrencySymbol } = params;

    const targetAsset = searchAsset({
        tokenName: cryptoCurrencySymbol,
        network: blockchainNetwork,
    })[0];

    if (!targetAsset) {
        return {
            error: `${cryptoCurrencySymbol} on network ${blockchainNetwork} is not supported at the moment`,
        };
    }

    const unmaskedUserIdentifier = convertBase64ToAsciiString(userId);

    const userWalletInfo = await UserService.getUserAssetWalletOrThrow(
        unmaskedUserIdentifier,
        targetAsset.listItemId
    );

    const walletAddressMessage = MessageGenerators.generateTextMessage(
        unmaskedUserIdentifier,
        userWalletInfo.walletAddress
    );

    await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, walletAddressMessage);

    return {
        nextSteps: `1. Copy the wallet address above 👆. \n2. Send ${targetAsset.tokenName} on ${targetAsset.network} from an external wallet or exchange to the copied wallet address.`,
    };
};

export const executeChangeTransactionPin = async (params: BaseWalletToolParams) => {
    const unmaskedUserIdentifier = convertBase64ToAsciiString(params.userId);

    const user = await UserService.getUserByPhoneNumber(unmaskedUserIdentifier);

    if (!user?.transactionPinHash) {
        return {
            error: 'Transaction pin not set',
        };
    }

    const message = WhatsAppBotChangeTransactionPinFlowService.withPhoneNumberId(
        env.WA_PHONE_NUMBER_ID
    ).createTransactionPinChangeFlowMessage({
        messageRecipient: unmaskedUserIdentifier,
        messageBody: 'Click on `Change Transaction PIN` to change your transaction PIN',
        flowCTA: 'Change Transaction PIN',
    });

    await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

    return {
        nextStep:
            'Please click on the `Change Transaction PIN` button above to change your transaction PIN',
    };
};

export const executeResetTransactionPin = async (params: BaseWalletToolParams) => {
    const unmaskedUserIdentifier = convertBase64ToAsciiString(params.userId);

    const user = await UserService.getUserByPhoneNumber(unmaskedUserIdentifier);

    if (!user?.transactionPinHash) {
        return {
            error: 'Transaction pin not set',
        };
    }

    const userSecurityQuestions = UserService.retrieveUserSecurityQuestions(user);

    const message = WhatsAppBotResetTransactionPinFlowService.withPhoneNumberId(
        env.WA_PHONE_NUMBER_ID
    ).createTransactionPinResetFlowMessage({
        messageRecipient: unmaskedUserIdentifier,
        messageBody: 'Click on `Reset Transaction PIN` to reset your transaction PIN',
        flowCTA: 'Reset Transaction PIN',
        userSecurityQuestions,
    });

    await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

    return {
        nextStep:
            'Please click on the `Reset Transaction PIN` button above to reset your transaction PIN',
    };
};

export const executeSwapTokensOnBase = async (params: SwapTokensOnBaseParams) => {
    const { fromToken, fromAmount, toToken, userId } = params;

    const supportedTokenSymbols = supportedTokenSymbolsForBaseSwap;

    if (fromToken.toLowerCase() === toToken.toLowerCase()) {
        return {
            error: 'Tokens to swap must be different',
        };
    }

    if (
        !validateWalletAddress(fromToken, 'Base') &&
        supportedTokenSymbols.indexOf(fromToken.toUpperCase() as TokenNames) === -1
    ) {
        return {
            error: `${fromToken} is not a valid token address`,
        };
    }
    if (
        !validateWalletAddress(toToken, 'Base') &&
        supportedTokenSymbols.indexOf(fromToken.toUpperCase() as TokenNames) === -1
    ) {
        return {
            error: `${toToken} is not a valid token address`,
        };
    }

    const [fromTokenAddress, toTokenAddress] = [fromToken, toToken].map((token) => {
        if (validateWalletAddress(token, 'Base') || token.toUpperCase() === TokenNames.ETH) {
            return token;
        }

        const asset = searchAsset({
            tokenName: token.toUpperCase() as TokenNames,
            network: 'Base',
        })[0];

        return asset?.tokenAddress;
    });

    let fromTokenMetadata: TokenMetadata;
    let toTokenMetadata: TokenMetadata;

    const networkConfig = getAppDefaultEvmConfig('Base', env.WEB3_ENVIRONMENT);
    const publicClient = getPublicClient(networkConfig.viemChain, networkConfig.rpcUrl);

    const ETH_METADATA = {
        id: 'ETH',
        name: 'Ethereum',
        symbol: 'ETH',
        decimals: 18,
    };

    try {
        fromTokenMetadata =
            fromToken === TokenNames.ETH
                ? ETH_METADATA
                : await Web3Library.getErc20TokenMetadata(publicClient, fromTokenAddress);
    } catch (error) {
        return {
            error: `${fromTokenAddress} possibly does not exist on the Base network`,
        };
    }
    try {
        toTokenMetadata =
            toToken === TokenNames.ETH
                ? ETH_METADATA
                : await Web3Library.getErc20TokenMetadata(publicClient, toTokenAddress);
    } catch (error) {
        return {
            error: `${toTokenAddress} possibly does not exist on the Base network`,
        };
    }

    const unmaskedUserId = convertBase64ToAsciiString(userId);
    const userWallet = await WalletKitService.getUserWalletByNetwork(unmaskedUserId, 'Base');

    const quote = await LiFiIntegrationLibrary.getQuote({
        fromToken: fromTokenMetadata.id,
        fromAmount: parseUnits(`${fromAmount}`, fromTokenMetadata.decimals).toString(),
        fromAddress: userWallet.address,
        toToken: toTokenMetadata.id,
        fromChain: networkConfig.viemChain.id,
        toChain: networkConfig.viemChain.id,
    });

    const quote_fromToken = quote.action.fromToken;
    const quote_toToken = quote.action.toToken;
    const slippage = quote.action.slippage;
    const quoteEstimate = quote.estimate;
    const transactionRequest = quote.transactionRequest;

    if (!transactionRequest) {
        return {
            error: 'Failed to get transaction request',
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

    const transactionSummaryMessageBody = [
        `🔄 _Swap_ *_${quote_fromToken.name} (${quote_fromToken.symbol})_* to *_${quote_toToken.name} (${quote_toToken.symbol})_*\n`,
        `From Amount: *${prettifiedFromAmount} ${quote_fromToken.symbol}*`,
        `To Amount: *${prettifiedToAmount} ${quote_toToken.symbol}*`,
        `1 ${quote_fromToken.symbol} = ${swapRate} ${quote_toToken.symbol}`,
        `Slippage: *${slippage * 100}%*`,
    ].join('\n');

    const transactionSummaryMessage =
        WhatsAppBotTransactionConfirmationFlowService.withPhoneNumberId(
            env.WA_PHONE_NUMBER_ID as PhoneNumberId
        ).createTransactionConfirmationFlowMessage({
            msgRecipient: unmaskedUserId,
            transactionSummary: transactionSummaryMessageBody
                .replaceAll('_', '')
                .replaceAll('*', ''),
            transactionMessageBody: `${transactionSummaryMessageBody}\n\nClick on 'Confirm Transaction' to confirm the swap`,
            transactionDetails: {
                transactionType: 'SWAP_TOKENS_ON_BASE',
                userId: userId,
                fromToken: fromTokenMetadata,
                toToken: toTokenMetadata,
                fromAmount: quoteEstimate.fromAmount,
                transactionRequest: transactionRequest,
                approvalAddress: quote.estimate.approvalAddress,
            },
        });

    await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, transactionSummaryMessage);

    return {
        nextStep:
            'The previous message already contains details of the swap, no need to repeat it, Just emphasise clicking on the `Confirm Transaction` button to the user.',
    };
};

/// This function might not be pretty, but works as is... for now
export const executeSwapTokens = async (params: SwapTokensParams) => {
    const { fromToken, fromAmount, toToken, userId, fromBlockchainNetwork, toBlockchainNetwork } =
        params;

    if (fromToken.toLowerCase() === toToken.toLowerCase()) {
        return {
            error: 'Tokens to swap must be different',
        };
    }

    if (!LiFiIntegrationLibrary.isSupportedChain(fromBlockchainNetwork)) {
        return {
            error: `Unsupported chain to swap from: ${fromBlockchainNetwork}`,
        };
    }

    if (!LiFiIntegrationLibrary.isSupportedChain(toBlockchainNetwork)) {
        return {
            error: `Unsupported chain to swap to: ${toBlockchainNetwork}`,
        };
    }

    const [fromTokenConfig, toTokenConfig] = [
        searchAsset({
            tokenName: fromToken,
            network: fromBlockchainNetwork,
        })[ZERO],
        searchAsset({
            tokenName: toToken,
            network: toBlockchainNetwork,
        })[ZERO],
    ];

    const unmaskedUserId = convertBase64ToAsciiString(userId);
    const userWallet = await WalletKitService.getUserWalletByNetwork(
        unmaskedUserId,
        fromBlockchainNetwork
    );

    const formattedAmount =
        fromBlockchainNetwork === 'Solana'
            ? await (async () => {
                  if (!validateWalletAddress(fromTokenConfig.tokenAddress, fromBlockchainNetwork)) {
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
                      fromBlockchainNetwork,
                      env.WEB3_ENVIRONMENT
                  );

                  if (!validateWalletAddress(fromTokenConfig.tokenAddress, fromBlockchainNetwork)) {
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
        LiFiIntegrationLibrary.getChainKey(fromBlockchainNetwork),
        LiFiIntegrationLibrary.getChainKey(toBlockchainNetwork),
    ];

    const quote = await LiFiIntegrationLibrary.getQuote({
        fromToken: fromTokenConfig.tokenAddress,
        fromAmount: formattedAmount,
        fromAddress: userWallet.address,
        toToken: toTokenConfig.tokenAddress,
        fromChain: fromChainKey,
        toChain: toChainKey,
    });

    const quote_fromToken = quote.action.fromToken;
    const quote_toToken = quote.action.toToken;
    const slippage = quote.action.slippage;
    const quoteEstimate = quote.estimate;
    const transactionRequest = quote.transactionRequest;

    if (!transactionRequest) {
        return {
            error: 'Failed to get transaction request',
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
            ? [`Chain: *${fromBlockchainNetwork}`]
            : [`From Chain: *${fromBlockchainNetwork}*`, `To Chain: *${toBlockchainNetwork}*`];

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
            env.WA_PHONE_NUMBER_ID as PhoneNumberId
        ).createTransactionConfirmationFlowMessage({
            msgRecipient: unmaskedUserId,
            transactionSummary: transactionSummaryMessageBody
                .replaceAll('_', '')
                .replaceAll('*', ''),
            transactionMessageBody: `${transactionSummaryMessageBody}\n\nClick on 'Confirm Transaction' to confirm the swap`,
            transactionDetails: {
                transactionType: 'SWAP_TOKENS',
                userId: userId,
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
                fromChain: fromBlockchainNetwork,
                toChain: toBlockchainNetwork,
            },
        });

    await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, transactionSummaryMessage);

    return {
        nextStep:
            'The previous message already contains details of the swap, no need to repeat it, Just emphasise clicking on the `Confirm Transaction` button to the user.',
    };
};
