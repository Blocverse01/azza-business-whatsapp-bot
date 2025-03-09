import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import SumSubService from '@/app/SumSub/SumSubService';
import { UserAssetItem } from '@/app/User/userSchema';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import {
    getHelpMessageText,
    getSupportContactsMessageText,
    getSupportedAssetAndNetworksText,
} from '@/app/WhatsAppBot/utils';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import {
    assetInteractiveButtonsIds,
    ExploreAssetActions,
    PhoneNumberParams,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import WhatsAppBotChangeTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotChangeTransactionPinFlowService';
import WhatsAppBotResetTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotResetTransactionPinFlowService';
import env from '@/constants/env';
import {
    BOT_COMMANDS_REGEX,
    extractGroups,
    type TradeAssetBotCommandMatchGroups,
} from '@/constants/regex';
import { getDynamicMaintainanceMessage } from '@/constants/strings';
import type { UserV2Record } from '@/db/xata';
import type { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import { TokenNames } from '@/resources/web3/core/tokens';
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';

type BotCommand = keyof typeof BOT_COMMANDS_REGEX;

class BotCommandHandler {
    public static async handlePossibleCommand(
        text: string,
        phoneParams: PhoneNumberParams,
        displayName: string,
        user: UserV2Record
    ): Promise<{
        handled: boolean;
    }> {
        const botCommand = BotCommandHandler.isCommand(text);

        if (!botCommand) {
            return {
                handled: false,
            };
        }

        switch (botCommand.command) {
            case 'RATES':
                await BotCommandHandler.getRates(phoneParams);
                break;
            case 'SELL_ASSET':
                await BotCommandHandler.sellAsset(user, phoneParams, botCommand.params);
                break;
            case 'BUY_ASSET':
                await BotCommandHandler.buyAsset(user, phoneParams, botCommand.params);
                break;
            case 'ASSETS_MENU':
                await BotCommandHandler.getAssetsMenu(user, phoneParams, displayName);
                break;
            case 'HELP':
                await BotCommandHandler.getHelp(phoneParams);
                break;
            case 'SUPPORT':
                await BotCommandHandler.getSupportContacts(phoneParams);
                break;
            case 'TRANSFER':
                await BotCommandHandler.transferAsset(user, phoneParams, botCommand.params);
                break;
            case 'BALANCES':
                await BotCommandHandler.getAllBalances(user, phoneParams);
                break;
            case 'ASSET_BALANCE':
                await BotCommandHandler.getAssetBalance(user, phoneParams, botCommand.params);
                break;
            case 'ENTITY_BALANCE':
                await BotCommandHandler.getAllBalances(user, phoneParams, botCommand.params);
                break;
            case 'DEPOSIT':
                await BotCommandHandler.depositAsset(user, phoneParams, botCommand.params);
                break;
            case 'RESET_PIN':
                await BotCommandHandler.resetTransactionPin(user, phoneParams);
                break;
            case 'CHANGE_PIN':
                await BotCommandHandler.changeTransactionPin(user, phoneParams);
                break;
            case 'PERFORM_KYC':
                await BotCommandHandler.handleKycVerificationRequest(user, phoneParams);
                break;
            default:
                return {
                    handled: false,
                };
        }

        return {
            handled: true,
        };
    }

    private static async getRates(phoneParams: PhoneNumberParams) {
        return await WhatsAppBotService.ratesCommandHandler(
            phoneParams.userPhoneNumber,
            phoneParams.businessPhoneNumberId
        );
    }

    private static async sellAsset(
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups
    ) {
        const [searchAssetForward, searchAssetBackward] = [
            azzaWalletManager.searchAssets({
                network: params.network as AllSupportedBlockchains,
                tokenName: params.asset,
            })[0],
            azzaWalletManager.searchAssets({
                network: params.asset as AllSupportedBlockchains,
                tokenName: params.network,
            })[0],
        ];

        if (!searchAssetForward && !searchAssetBackward) {
            const responseMessage = !searchAssetForward
                ? `${params.asset} on ${params.network} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText(
                      {
                          action: ExploreAssetActions.BUY_ASSET,
                      }
                  )}`
                : `${params.network} on ${params.asset} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText(
                      {
                          action: ExploreAssetActions.BUY_ASSET,
                      }
                  )}`;

            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, responseMessage)
            );

            return;
        }

        const supportedAsset = searchAssetForward ? searchAssetForward : searchAssetBackward;

        if (!supportedAsset.supportedAssetActions.includes(ExploreAssetActions.BUY_ASSET)) {
            const responseMessage = `Selling ${params.asset} on ${params.network} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText(
                {
                    action: ExploreAssetActions.SELL_ASSET,
                }
            )}`;

            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, responseMessage)
            );

            return;
        }

        return await WhatsAppBotService.handleSellAssetAction(
            user,
            phoneParams,
            supportedAsset.listItemId
        );
    }

    private static async buyAsset(
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups
    ) {
        const [searchAssetForward, searchAssetBackward] = [
            azzaWalletManager.searchAssets({
                network: params.network as AllSupportedBlockchains,
                tokenName: params.asset,
            })[0],
            azzaWalletManager.searchAssets({
                network: params.asset as AllSupportedBlockchains,
                tokenName: params.network,
            })[0],
        ];

        if (!searchAssetForward && !searchAssetBackward) {
            const responseMessage = !searchAssetForward
                ? `${params.asset} on ${params.network} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText(
                      {
                          action: ExploreAssetActions.BUY_ASSET,
                      }
                  )}`
                : `${params.network} on ${params.asset} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText(
                      {
                          action: ExploreAssetActions.BUY_ASSET,
                      }
                  )}`;

            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, responseMessage)
            );

            return;
        }

        const supportedAsset = searchAssetForward ? searchAssetForward : searchAssetBackward;

        if (!supportedAsset.supportedAssetActions.includes(ExploreAssetActions.BUY_ASSET)) {
            const responseMessage = `Buying ${params.asset} on ${params.network} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText(
                {
                    action: ExploreAssetActions.BUY_ASSET,
                }
            )}`;

            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, responseMessage)
            );

            return;
        }

        return await WhatsAppBotService.handleBuyAssetAction(
            user,
            phoneParams,
            supportedAsset.listItemId
        );
    }

    private static async getAssetsMenu(
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        displayName: string
    ) {
        const coreMaintainanceIsEnabled = await FeatureFlagService.isFeatureEnabled(
            FeatureFlagKey.CORE_MAINTAINANCE
        );

        if (coreMaintainanceIsEnabled) {
            const maintainanceMessage = getDynamicMaintainanceMessage('asset management', {
                length: 3,
                name: 'hours',
            });
            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    phoneParams.userPhoneNumber,
                    maintainanceMessage
                )
            );

            return;
        }

        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;

        const supportedChains = azzaWalletManager.getSupportedNetworks();
        const allUserWallets = await Promise.all(
            supportedChains.map((chain) => azzaWalletManager.getUserWallet(user.id, chain))
        );

        const userWallets = azzaWalletManager
            .getSupportedAssets()
            .map((assetConfig) => {
                const wallet = allUserWallets.find(
                    (wallet) => wallet.blockchainNetwork === assetConfig.network
                );

                if (wallet) {
                    return {
                        network: wallet.blockchainNetwork,
                        name: assetConfig.tokenName as TokenNames,
                        listItemId: assetConfig.listItemId,
                        walletAddress: wallet.address,
                        tokenAddress: assetConfig.tokenAddress,
                    } satisfies UserAssetItem;
                }
            })
            .filter((wallet) => wallet !== undefined);

        await WhatsAppBotService.listWalletAddressMessage(
            businessPhoneNumberId,
            displayName,
            userPhoneNumber,
            userWallets,
            'old_account'
        );
    }

    private static async getSupportContacts(phoneParams: PhoneNumberParams) {
        const responseMessage = getSupportContactsMessageText();

        await WhatsAppBotService.sendWhatsappMessage(
            phoneParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, responseMessage)
        );
        return;
    }

    private static async getHelp(phoneParams: PhoneNumberParams) {
        const responseMessage = getHelpMessageText();

        await WhatsAppBotService.sendWhatsappMessage(
            phoneParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, responseMessage)
        );
        return;
    }

    private static async transferAsset(
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups
    ) {
        const coreMaintainanceIsEnabled = await FeatureFlagService.isFeatureEnabled(
            FeatureFlagKey.CORE_MAINTAINANCE
        );

        if (coreMaintainanceIsEnabled) {
            const maintainanceMessage = getDynamicMaintainanceMessage('withdrawal', {
                length: 3,
                name: 'hours',
            });
            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    phoneParams.userPhoneNumber,
                    maintainanceMessage
                )
            );
            return;
        }

        const [searchAssetForward, searchAssetBackward] = [
            azzaWalletManager.searchAssets({
                network: params.network as AllSupportedBlockchains,
                tokenName: params.asset,
            })[0],
            azzaWalletManager.searchAssets({
                network: params.asset as AllSupportedBlockchains,
                tokenName: params.network,
            })[0],
        ];

        if (!searchAssetForward && !searchAssetBackward) {
            const responseMessage = !searchAssetForward
                ? `${params.asset} on ${params.network} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText()}`
                : `${params.network} on ${params.asset} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText()}`;

            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, responseMessage)
            );

            return;
        }

        const supportedAsset = searchAssetForward ? searchAssetForward : searchAssetBackward;

        return await WhatsAppBotService.handleWithdrawAssetAction(
            user,
            phoneParams,
            supportedAsset.listItemId
        );
    }

    private static async depositAsset(
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups
    ) {
        const coreMaintainanceIsEnabled = await FeatureFlagService.isFeatureEnabled(
            FeatureFlagKey.CORE_MAINTAINANCE
        );

        if (coreMaintainanceIsEnabled) {
            const maintainanceMessage = getDynamicMaintainanceMessage('deposit', {
                length: 3,
                name: 'hours',
            });
            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    phoneParams.userPhoneNumber,
                    maintainanceMessage
                )
            );
            return;
        }

        const [searchAssetForward, searchAssetBackward] = [
            azzaWalletManager.searchAssets({
                network: params.network as AllSupportedBlockchains,
                tokenName: params.asset,
            })[0],
            azzaWalletManager.searchAssets({
                network: params.asset as AllSupportedBlockchains,
                tokenName: params.network,
            })[0],
        ];

        if (!searchAssetForward && !searchAssetBackward) {
            const responseMessage = !searchAssetForward
                ? `${params.asset} on ${params.network} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText()}`
                : `${params.network} on ${params.asset} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText()}`;

            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, responseMessage)
            );

            return;
        }

        const supportedAsset = searchAssetForward ? searchAssetForward : searchAssetBackward;

        return await WhatsAppBotService.depositAssetCommandHandler(
            user,
            phoneParams,
            supportedAsset.listItemId
        );
    }

    private static async getAllBalances(
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        params?: Partial<TradeAssetBotCommandMatchGroups>
    ) {
        const coreMaintainanceIsEnabled = await FeatureFlagService.isFeatureEnabled(
            FeatureFlagKey.CORE_MAINTAINANCE
        );

        if (coreMaintainanceIsEnabled) {
            const maintainanceMessage = getDynamicMaintainanceMessage('balance', {
                length: 3,
                name: 'hours',
            });
            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    phoneParams.userPhoneNumber,
                    maintainanceMessage
                )
            );
            return;
        }

        return await WhatsAppBotService.handleUserBalancesQuery(user, phoneParams, params);
    }

    private static async getAssetBalance(
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups
    ) {
        const coreMaintainanceIsEnabled = await FeatureFlagService.isFeatureEnabled(
            FeatureFlagKey.CORE_MAINTAINANCE
        );

        if (coreMaintainanceIsEnabled) {
            const maintainanceMessage = getDynamicMaintainanceMessage('balance', {
                length: 3,
                name: 'hours',
            });
            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(
                    phoneParams.userPhoneNumber,
                    maintainanceMessage
                )
            );
            return;
        }

        const [searchAssetForward, searchAssetBackward] = [
            azzaWalletManager.searchAssets({
                network: params.network as AllSupportedBlockchains,
                tokenName: params.asset,
            })[0],
            azzaWalletManager.searchAssets({
                network: params.asset as AllSupportedBlockchains,
                tokenName: params.network,
            })[0],
        ];

        if (!searchAssetForward && !searchAssetBackward) {
            const responseMessage = !searchAssetForward
                ? `${params.asset} on ${params.network} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText()}`
                : `${params.network} on ${params.asset} is not supported yet.\n\nSupported assets and chains:\n${getSupportedAssetAndNetworksText()}`;

            await WhatsAppBotService.sendWhatsappMessage(
                phoneParams.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(phoneParams.userPhoneNumber, responseMessage)
            );

            return;
        }

        const supportedAsset = searchAssetForward ? searchAssetForward : searchAssetBackward;

        return await WhatsAppBotService.handleUserAssetBalanceQuery(
            user,
            phoneParams,
            supportedAsset.listItemId
        );
    }

    private static async resetTransactionPin(user: UserV2Record, params: PhoneNumberParams) {
        if (!user?.transactionPinHash) {
            return await WhatsAppBotService.sendArbitraryTextMessage(
                params.userPhoneNumber,
                'Transaction PIN not set for your account.'
            );
        }

        const userSecurityQuestions = userServiceV2.retrieveUserSecurityQuestions(user);

        const message = WhatsAppBotResetTransactionPinFlowService.withPhoneNumberId(
            params.businessPhoneNumberId as PhoneNumberId
        ).createTransactionPinResetFlowMessage(user, {
            messageRecipient: params.userPhoneNumber,
            messageBody: 'Click on `Reset Transaction PIN` to reset your transaction PIN',
            flowCTA: 'Reset Transaction PIN',
            userSecurityQuestions,
        });

        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
    }

    private static async changeTransactionPin(user: UserV2Record, params: PhoneNumberParams) {
        if (!user?.transactionPinHash) {
            return await WhatsAppBotService.sendArbitraryTextMessage(
                params.userPhoneNumber,
                'Transaction PIN not set for your account.'
            );
        }

        const message = WhatsAppBotChangeTransactionPinFlowService.withPhoneNumberId(
            env.WA_PHONE_NUMBER_ID
        ).createTransactionPinChangeFlowMessage(user, {
            messageRecipient: params.userPhoneNumber,
            messageBody: 'Click on `Change Transaction PIN` to change your transaction PIN',
            flowCTA: 'Change Transaction PIN',
        });

        await WhatsAppBotService.sendWhatsappMessage(params.businessPhoneNumberId, message);
    }

    private static async handleKycVerificationRequest(
        user: UserV2Record,
        params: PhoneNumberParams
    ) {
        const userKycStatus = userServiceV2.formatKycStatus(user.kycStatus);

        if (userKycStatus === 'verified') {
            const responseMessage = `Your KYC is already verified.`;
            await WhatsAppBotService.sendWhatsappMessage(
                params.businessPhoneNumberId,
                MessageGenerators.generateTextMessage(params.userPhoneNumber, responseMessage)
            );

            return;
        }

        if (SumSubService.SERVICE_IS_ACTIVE) {
            if (
                userKycStatus === 'unverified' ||
                userKycStatus === 'rejected' ||
                userKycStatus === 'pending'
            ) {
                await WhatsAppBotService.sendKycVerificationUrlMessage(user, params);
                return;
            }

            if (userKycStatus === 'in_review') {
                await WhatsAppBotService.sendKycInReviewMessage(params);
                return;
            }
        }

        const responseMessage = `KYC verification is not available at the moment.`;
        await WhatsAppBotService.sendWhatsappMessage(
            params.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(params.userPhoneNumber, responseMessage)
        );
    }

    public static isCommand(command: string) {
        const commandRegex = Object.values(BOT_COMMANDS_REGEX).find((regex) => regex.test(command));

        if (!commandRegex) {
            return undefined;
        }

        const commandName = Object.keys(BOT_COMMANDS_REGEX).find(
            (key) => BOT_COMMANDS_REGEX[key as BotCommand] === commandRegex
        ) as BotCommand;

        switch (commandName) {
            case 'SELL_ASSET':
            case 'BUY_ASSET':
            case 'TRANSFER':
            case 'DEPOSIT':
                const { asset, network } = extractGroups<TradeAssetBotCommandMatchGroups>(
                    command,
                    BOT_COMMANDS_REGEX[commandName]
                );

                return {
                    command: commandName,
                    params: {
                        asset,
                        network,
                    },
                };
            case 'ASSET_BALANCE':
                const { asset: assetParam, network: networkParam } =
                    extractGroups<TradeAssetBotCommandMatchGroups>(
                        command,
                        BOT_COMMANDS_REGEX[commandName]
                    );

                return {
                    command: commandName,
                    params: {
                        asset: assetParam,
                        network: networkParam,
                    },
                };
            case 'ENTITY_BALANCE':
                const { entity } = extractGroups<{ entity: string }>(
                    command,
                    BOT_COMMANDS_REGEX[commandName]
                );

                const isNetwork = assetInteractiveButtonsIds.some(
                    (asset) => asset.split('-')[1] === entity
                );

                return {
                    command: commandName,
                    params: isNetwork ? { network: entity } : { asset: entity },
                };
            default:
                return {
                    command: commandName,
                    params: {},
                };
        }
    }
}

export default BotCommandHandler;
