import {
    BaseWalletToolParams,
    DepositCryptoAssetParams,
    RequestTransactionPinSetupParams,
    TransferCryptoAssetParams,
    WalletBalanceParams,
} from '@/app/aiAgent/agent.schema';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotChangeTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotChangeTransactionPinFlowService';
import WhatsAppBotResetTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotResetTransactionPinFlowService';
import WhatsAppBotSetupTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotSetupTransactionPinFlowService';
import { getNetworkEmoji } from '@/resources/utils/bot-message-utils';
import { convertBase64ToAsciiString } from '@/resources/utils/encryption';
import { ENABLED_ASSETS, searchAsset } from '@/config/whatsAppBot';
import UserService from '@/app/User/UserService';
import { validateWalletAddress } from '@/resources/utils/validators';
import { cleanPhoneNumberInput } from '@/resources/utils/phone-numbers';
import WalletAssetManagementService from '@/app/WalletAssetManagement/WalletAssetManagementService';
import { UserAssetInfo } from '@/app/User/userSchema';
import { getUserCountryCodeFromPhoneNumberOrThrow } from '@/resources/utils/currency';
import WhatsAppBotTransactionConfirmationFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransactionConfirmationFlowService';
import env from '@/constants/env';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { AssetTransferRecipientType } from '@/app/azza/azza.schema';

export const executeTransferAsset = async (params: TransferCryptoAssetParams) => {
    const { cryptoCurrencySymbol, recipient, amount, blockchainNetwork, userId } = params;

    const targetAsset = searchAsset({
        tokenName: cryptoCurrencySymbol,
        network: blockchainNetwork,
    })[0];

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
              })[0]
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
