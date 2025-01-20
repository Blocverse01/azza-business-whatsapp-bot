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
import { AssetTransferRecipientType, TokenMetadata } from '@/app/azza/azza.schema';
import { AssetBalance } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import { getDefaultSolanaNode, getSolanaNetworkClient } from '@/app/ExtendedWallet/solana/config';
import ExtendedSolanaWalletLibrary from '@/app/ExtendedWallet/solana/ExtendedSolanaWalletLibrary';
import LiFiIntegrationLibrary from '@/app/LiFi/LiFiIntegrationLibrary';
import UserService from '@/app/User/UserService';
import WalletAssetManagementService from '@/app/WalletAssetManagement/WalletAssetManagementService';
import Web3Library from '@/app/WalletAssetManagement/Web3Library';
import WalletKitService from '@/app/WalletKit/WalletKitService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import WhatsAppBotChangeTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotChangeTransactionPinFlowService';
import WhatsAppBotResetTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotResetTransactionPinFlowService';
import WhatsAppBotSetupTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotSetupTransactionPinFlowService';
import WhatsAppBotTransactionConfirmationFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransactionConfirmationFlowService';
import {
    canAccessFeature,
    deriveUserFeatureAccessLevel,
    FeatureAccessLevel,
} from '@/config/whatsAppBot';
import env from '@/constants/env';
import { ZERO } from '@/constants/numbers';
import { getNetworkEmoji } from '@/resources/utils/bot-message-utils';
import {
    getUserCountryCodeFromPhoneNumberOrThrow,
    prettifyNumber,
} from '@/resources/utils/currency';
import { cleanPhoneNumberInput } from '@/resources/utils/phone-numbers';
import { validateWalletAddress } from '@/resources/utils/validators';
import { getAppDefaultEvmConfig } from '@/resources/web3/evm/evm.config';
import { getPublicClient } from '@/resources/web3/evm/viem/clients';
import { TokenNames } from '@/resources/web3/tokens';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { formatUnits, getAddress, parseUnits } from 'viem';

export const executeTransferAsset = async (params: TransferCryptoAssetParams) => {
    const { cryptoCurrencySymbol, recipient, amount, blockchainNetwork, user, phoneParams } =
        params;

    const targetAsset = azzaWalletManager.searchAssets({
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

    const assetInfo = await azzaWalletManager.getAssetBalance({
        userId: user.id,
        assetId: targetAsset.listItemId,
    });

    if (assetInfo.balance < amount) {
        return {
            error: `Insufficient balance. You have ${assetInfo.balance} ${cryptoCurrencySymbol}`,
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

    if (assetInfo.balance < totalAmount) {
        const amountDeficit = totalAmount - assetInfo.balance;

        return {
            error: `You need extra ${amountDeficit} ${targetAsset.tokenName} on ${targetAsset.network} to cover for transaction fee`,
            transactionAmount: amount,
            transactionFee,
            availableBalance: assetInfo.balance,
            amountDeficit,
        };
    }

    const message = WhatsAppBotTransactionConfirmationFlowService.withPhoneNumberId(
        env.WA_PHONE_NUMBER_ID
    ).createTransactionConfirmationFlowMessage({
        transactionSummary: `Send ${amount} ${targetAsset.tokenName} to ${recipient}`,
        transactionMessageBody: `Click on 'Confirm Transaction' to confirm sending ${amount} ${targetAsset.tokenName} to ${recipient}`,
        msgRecipient: phoneParams.userPhoneNumber,
        transactionDetails: {
            transactionType: 'SEND',
            recipient,
            recipientType,
            amount,
            assetId: targetAsset.listItemId,
            transactionFee,
            userId: user.id,
        },
    });

    await WhatsAppBotService.sendWhatsappMessage(phoneParams.businessPhoneNumberId, message);

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
    const { cryptoCurrencySymbol, blockchainNetwork, user } = params;

    const supportedAssets = azzaWalletManager.getSupportedAssets();

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
            const assetInfo = await azzaWalletManager.getAssetBalance({
                userId: user.id,
                assetId: balanceQueryMode.entity.listItemId,
            });

            return {
                balance: assetInfo,
                asset: balanceQueryMode.entity,
                networkEmoji: getNetworkEmoji(assetInfo.blockchainNetwork),
            };

        case 'asset on any network':
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

            return {
                balances: assetBalances,
                asset: balanceQueryMode.entity,
            };

        case 'network':
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

            return {
                balances,
                network: balanceQueryMode.entity,
                networkEmoji: getNetworkEmoji(balanceQueryMode.entity),
            };

        case 'all':
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

            return {
                balances: groupedAssets,
            };
    }
};

export const executeRequestTransactionPinSetup = async (
    params: RequestTransactionPinSetupParams
) => {
    const { user, phoneParams } = params;

    if (user?.transactionPinHash) {
        return {
            message: 'Transaction pin already set',
        };
    }

    const message = WhatsAppBotSetupTransactionPinFlowService.withPhoneNumberId(
        phoneParams.businessPhoneNumberId as PhoneNumberId
    ).createSetupTransactionPinFlowMessage(user, {
        messageRecipient: phoneParams.userPhoneNumber,
        messageBody:
            'Please click on the `Set up Transaction PIN` button to set up your transaction PIN',
    });

    await WhatsAppBotService.sendWhatsappMessage(phoneParams.businessPhoneNumberId, message);

    return {
        nextStep:
            'Please click on the `Set up Transaction PIN` button above to set up your transaction PIN',
    };
};

export const executeDepositCryptoAsset = async (params: DepositCryptoAssetParams) => {
    const { user, phoneParams, blockchainNetwork, cryptoCurrencySymbol } = params;

    const targetAsset = azzaWalletManager.searchAssets({
        tokenName: cryptoCurrencySymbol,
        network: blockchainNetwork,
    })[0];

    if (!targetAsset) {
        return {
            error: `${cryptoCurrencySymbol} on network ${blockchainNetwork} is not supported at the moment`,
        };
    }

    const userWalletInfo = await azzaWalletManager.getUserWallet(user.id, targetAsset.network);

    const walletAddressMessage = MessageGenerators.generateTextMessage(
        phoneParams.userPhoneNumber,
        userWalletInfo.address
    );

    await WhatsAppBotService.sendWhatsappMessage(
        phoneParams.businessPhoneNumberId,
        walletAddressMessage
    );

    return {
        nextSteps: `1. Copy the wallet address above 👆. \n2. Send ${targetAsset.tokenName} on ${targetAsset.network} from an external wallet or exchange to the copied wallet address.`,
    };
};

export const executeChangeTransactionPin = async (params: BaseWalletToolParams) => {
    const user = params.user;
    const { businessPhoneNumberId, userPhoneNumber } = params.phoneParams;

    if (!user?.transactionPinHash) {
        return {
            error: 'Transaction pin not set',
        };
    }

    const message = WhatsAppBotChangeTransactionPinFlowService.withPhoneNumberId(
        businessPhoneNumberId as PhoneNumberId
    ).createTransactionPinChangeFlowMessage(user, {
        messageRecipient: userPhoneNumber,
        messageBody: 'Click on `Change Transaction PIN` to change your transaction PIN',
        flowCTA: 'Change Transaction PIN',
    });

    await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, message);

    return {
        nextStep:
            'Please click on the `Change Transaction PIN` button above to change your transaction PIN',
    };
};

export const executeResetTransactionPin = async (params: BaseWalletToolParams) => {
    const user = params.user;
    const { businessPhoneNumberId, userPhoneNumber } = params.phoneParams;

    if (!user?.transactionPinHash) {
        return {
            error: 'Transaction pin not set',
        };
    }

    const userSecurityQuestions = userServiceV2.retrieveUserSecurityQuestions(user);

    const message = WhatsAppBotResetTransactionPinFlowService.withPhoneNumberId(
        businessPhoneNumberId as PhoneNumberId
    ).createTransactionPinResetFlowMessage(user, {
        messageRecipient: userPhoneNumber,
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
    const { fromToken, fromAmount, toToken, user, phoneParams } = params;

    const { businessPhoneNumberId, userPhoneNumber } = phoneParams;

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

        const asset = azzaWalletManager.searchAssets({
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

    const userWallet = await WalletKitService.getUserWalletByNetwork(user.id, 'Base');

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
            businessPhoneNumberId as PhoneNumberId
        ).createTransactionConfirmationFlowMessage({
            msgRecipient: userPhoneNumber,
            transactionSummary: transactionSummaryMessageBody
                .replaceAll('_', '')
                .replaceAll('*', ''),
            transactionMessageBody: `${transactionSummaryMessageBody}\n\nClick on 'Confirm Transaction' to confirm the swap`,
            transactionDetails: {
                transactionType: 'SWAP_TOKENS_ON_BASE',
                userId: user.id,
                fromToken: fromTokenMetadata,
                toToken: toTokenMetadata,
                fromAmount: quoteEstimate.fromAmount,
                transactionRequest: transactionRequest,
                approvalAddress: quote.estimate.approvalAddress,
            },
        });

    await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, transactionSummaryMessage);

    return {
        nextStep:
            'The previous message already contains details of the swap, no need to repeat it, Just emphasise clicking on the `Confirm Transaction` button to the user.',
    };
};

/// This function might not be pretty, but works as is... for now
export const executeSwapTokens = async (params: SwapTokensParams) => {
    const {
        fromToken,
        fromAmount,
        toToken,
        user,
        phoneParams,
        fromBlockchainNetwork,
        toBlockchainNetwork,
    } = params;
    const { businessPhoneNumberId, userPhoneNumber } = phoneParams;

    const userAccessLevel = deriveUserFeatureAccessLevel(user.FEATURE_ACCESS_LEVEL);
    if (!canAccessFeature(userAccessLevel, FeatureAccessLevel.STAGING)) {
        return {
            message:
                "The swapping feature is currently not available! You'll be the first to know when it's back up.",
        };
    }

    if (
        fromToken.toLowerCase() === toToken.toLowerCase() &&
        fromBlockchainNetwork === toBlockchainNetwork
    ) {
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
        azzaWalletManager.searchAssets({
            tokenName: fromToken,
            network: fromBlockchainNetwork,
        })[ZERO],
        azzaWalletManager.searchAssets({
            tokenName: toToken,
            network: toBlockchainNetwork,
        })[ZERO],
    ];

    await WhatsAppBotService.sendArbitraryTextMessage(
        userPhoneNumber,
        '⏺️ Getting a quote for your swap... Please wait.'
    );
    const [fromUserWallet, toUserWallet] = await Promise.all([
        UserService.getUserAssetWalletOrThrow(userPhoneNumber, fromTokenConfig.listItemId),
        UserService.getUserAssetWalletOrThrow(userPhoneNumber, toTokenConfig.listItemId),
    ]);

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
            msgRecipient: userPhoneNumber,
            transactionSummary: transactionSummaryMessageBody
                .replaceAll('_', '')
                .replaceAll('*', ''),
            transactionMessageBody: `${transactionSummaryMessageBody}\n\nClick on 'Confirm Transaction' to confirm the swap`,
            transactionDetails: {
                transactionType: 'SWAP_TOKENS',
                userId: user.id,
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

    await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, transactionSummaryMessage);

    return {
        nextStep:
            'The previous message already contains details of the swap, no need to repeat it, Just emphasise clicking on the `Confirm Transaction` button to the user.',
    };
};
