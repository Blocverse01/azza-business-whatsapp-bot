import UserService from '@/app/User/UserService';
import { SupportedChain } from '@/app/WalletKit/walletKitSchema';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import { getSupportedAssetAndNetworksText } from '@/app/WhatsAppBot/utils';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import {
    assetInteractiveButtonsIds,
    ExploreAssetActions,
    PhoneNumberParams,
} from '@/app/WhatsAppBot/WhatsAppBotType';
import { PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import WhatsAppBotChangeTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotChangeTransactionPinFlowService';
import WhatsAppBotResetTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotResetTransactionPinFlowService';
import { FeatureAccessLevel, searchAsset } from '@/config/whatsAppBot';
import env from '@/constants/env';
import {
    BOT_COMMANDS_REGEX,
    extractGroups,
    TradeAssetBotCommandMatchGroups,
} from '@/constants/regex';

type BotCommand = keyof typeof BOT_COMMANDS_REGEX;

class BotCommandHandler {
    public static async handlePossibleCommand(
        text: string,
        phoneParams: PhoneNumberParams,
        displayName: string,
        userAccessLevel: FeatureAccessLevel
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
                await BotCommandHandler.sellAsset(phoneParams, botCommand.params, userAccessLevel);
                break;
            case 'BUY_ASSET':
                await BotCommandHandler.buyAsset(phoneParams, botCommand.params, userAccessLevel);
                break;
            case 'ASSETS_MENU':
                await BotCommandHandler.getAssetsMenu(phoneParams, displayName);
                break;
            case 'HELP':
                await BotCommandHandler.getHelp(phoneParams);
                break;
            case 'TRANSFER':
                await BotCommandHandler.transferAsset(phoneParams, botCommand.params);
                break;
            case 'BALANCES':
                await BotCommandHandler.getAllBalances(phoneParams);
                break;
            case 'ASSET_BALANCE':
                await BotCommandHandler.getAssetBalance(phoneParams, botCommand.params);
                break;
            case 'ENTITY_BALANCE':
                await BotCommandHandler.getAllBalances(phoneParams, botCommand.params);
                break;
            case 'DEPOSIT':
                await BotCommandHandler.depositAsset(phoneParams, botCommand.params);
                break;
            case 'RESET_PIN':
                await BotCommandHandler.resetTransactionPin(phoneParams);
                break;
            case 'CHANGE_PIN':
                await BotCommandHandler.changeTransactionPin(phoneParams);
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
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups,
        userFeatureAccessLevel: FeatureAccessLevel
    ) {
        const [searchAssetForward, searchAssetBackward] = [
            searchAsset({
                network: params.network as SupportedChain,
                tokenName: params.asset,
            })[0],
            searchAsset({
                network: params.asset as SupportedChain,
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
            phoneParams,
            supportedAsset.listItemId,
            userFeatureAccessLevel
        );
    }

    private static async buyAsset(
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups,
        userFeatureAccessLevel: FeatureAccessLevel
    ) {
        const [searchAssetForward, searchAssetBackward] = [
            searchAsset({
                network: params.network as SupportedChain,
                tokenName: params.asset,
            })[0],
            searchAsset({
                network: params.asset as SupportedChain,
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
            phoneParams,
            supportedAsset.listItemId,
            userFeatureAccessLevel
        );
    }

    private static async getAssetsMenu(phoneParams: PhoneNumberParams, displayName: string) {
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;

        const user = await UserService.userExists(userPhoneNumber);

        if (user) {
            const userWallets = await UserService.getUserWalletAssetsList(userPhoneNumber);
            await WhatsAppBotService.listWalletAddressMessage(
                businessPhoneNumberId,
                displayName,
                userPhoneNumber,
                userWallets,
                'old_account'
            );
        } else {
            await WhatsAppBotService.createWalletMessage(
                businessPhoneNumberId,
                displayName,
                userPhoneNumber
            );
        }
    }

    private static async getHelp(phoneParams: PhoneNumberParams) {
        return;
    }

    private static async transferAsset(
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups
    ) {
        const [searchAssetForward, searchAssetBackward] = [
            searchAsset({
                network: params.network as SupportedChain,
                tokenName: params.asset,
            })[0],
            searchAsset({
                network: params.asset as SupportedChain,
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
            phoneParams,
            supportedAsset.listItemId
        );
    }

    private static async depositAsset(
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups
    ) {
        const [searchAssetForward, searchAssetBackward] = [
            searchAsset({
                network: params.network as SupportedChain,
                tokenName: params.asset,
            })[0],
            searchAsset({
                network: params.asset as SupportedChain,
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
            phoneParams.userPhoneNumber,
            phoneParams.businessPhoneNumberId,
            supportedAsset.listItemId
        );
    }

    private static async getAllBalances(
        phoneParams: PhoneNumberParams,
        params?: Partial<TradeAssetBotCommandMatchGroups>
    ) {
        return await WhatsAppBotService.handleUserBalancesQuery(phoneParams, params);
    }

    private static async getAssetBalance(
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups
    ) {
        const [searchAssetForward, searchAssetBackward] = [
            searchAsset({
                network: params.network as SupportedChain,
                tokenName: params.asset,
            })[0],
            searchAsset({
                network: params.asset as SupportedChain,
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
            phoneParams,
            supportedAsset.listItemId
        );
    }

    private static async resetTransactionPin(params: PhoneNumberParams) {
        const user = await UserService.getUserByPhoneNumber(params.userPhoneNumber);

        if (!user?.transactionPinHash) {
            return await WhatsAppBotService.sendArbitraryTextMessage(
                params.userPhoneNumber,
                'Transaction PIN not set for your account.'
            );
        }

        const userSecurityQuestions = UserService.retrieveUserSecurityQuestions(user);

        const message = WhatsAppBotResetTransactionPinFlowService.withPhoneNumberId(
            params.businessPhoneNumberId as PhoneNumberId
        ).createTransactionPinResetFlowMessage({
            messageRecipient: params.userPhoneNumber,
            messageBody: 'Click on `Reset Transaction PIN` to reset your transaction PIN',
            flowCTA: 'Reset Transaction PIN',
            userSecurityQuestions,
        });

        await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
    }

    private static async changeTransactionPin(params: PhoneNumberParams) {
        const user = await UserService.getUserByPhoneNumber(params.userPhoneNumber);

        if (!user?.transactionPinHash) {
            return await WhatsAppBotService.sendArbitraryTextMessage(
                params.userPhoneNumber,
                'Transaction PIN not set for your account.'
            );
        }

        const message = WhatsAppBotChangeTransactionPinFlowService.withPhoneNumberId(
            env.WA_PHONE_NUMBER_ID
        ).createTransactionPinChangeFlowMessage({
            messageRecipient: params.userPhoneNumber,
            messageBody: 'Click on `Change Transaction PIN` to change your transaction PIN',
            flowCTA: 'Change Transaction PIN',
        });

        await WhatsAppBotService.sendWhatsappMessage(params.businessPhoneNumberId, message);
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
