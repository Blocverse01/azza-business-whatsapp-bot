import {
    BaseWalletToolParams,
    DepositCryptoAssetParams,
    RequestTransactionPinSetupParams,
    TransferCryptoAssetParams,
    WalletBalanceParams,
} from '@/app/aiAgent/agent.schema';
import { AssetTransferRecipientType } from '@/app/azza/azza.schema';
import { AssetBalance } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import WalletAssetManagementService from '@/app/WalletAssetManagement/WalletAssetManagementService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import { PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import WhatsAppBotChangeTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotChangeTransactionPinFlowService';
import WhatsAppBotResetTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotResetTransactionPinFlowService';
import WhatsAppBotSetupTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotSetupTransactionPinFlowService';
import WhatsAppBotTransactionConfirmationFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransactionConfirmationFlowService';
import env from '@/constants/env';
import { ZERO } from '@/constants/numbers';
import { getNetworkEmoji } from '@/resources/utils/bot-message-utils';
import { getUserCountryCodeFromPhoneNumberOrThrow } from '@/resources/utils/currency';
import { cleanPhoneNumberInput } from '@/resources/utils/phone-numbers';
import { validateWalletAddress } from '@/resources/utils/validators';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';

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
