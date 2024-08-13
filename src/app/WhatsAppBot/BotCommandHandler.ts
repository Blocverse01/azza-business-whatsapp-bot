import { assetInteractiveButtonsIds, PhoneNumberParams } from '@/app/WhatsAppBot/WhatsAppBotType';
import {
    BOT_COMMANDS_REGEX,
    extractGroups,
    TradeAssetBotCommandMatchGroups,
} from '@/constants/regex';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';
import UserService from '@/app/User/UserService';

type BotCommand = keyof typeof BOT_COMMANDS_REGEX;

class BotCommandHandler {
    public static async handlePossibleCommand(
        text: string,
        phoneParams: PhoneNumberParams,
        displayName: string
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
                await BotCommandHandler.sellAsset(phoneParams, botCommand.params);
                break;
            case 'BUY_ASSET':
                await BotCommandHandler.buyAsset(phoneParams, botCommand.params);
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
            default:
                break;
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
        params: TradeAssetBotCommandMatchGroups
    ) {
        const supportedAsset = assetInteractiveButtonsIds.find(
            (assetInteractiveButtonId) =>
                assetInteractiveButtonId === `${params.asset}-${params.network}`
        );

        if (!supportedAsset) {
            return;
        }

        return await WhatsAppBotService.handleSellAssetAction(phoneParams, supportedAsset);
    }

    private static async buyAsset(
        phoneParams: PhoneNumberParams,
        params: TradeAssetBotCommandMatchGroups
    ) {
        const supportedAsset = assetInteractiveButtonsIds.find(
            (assetInteractiveButtonId) =>
                assetInteractiveButtonId === `${params.asset}-${params.network}`
        );

        if (!supportedAsset) {
            return;
        }

        return await WhatsAppBotService.handleBuyAssetAction(phoneParams, supportedAsset);
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
        const supportedAsset = assetInteractiveButtonsIds.find(
            (assetInteractiveButtonId) =>
                assetInteractiveButtonId === `${params.asset}-${params.network}`
        );

        if (!supportedAsset) {
            return;
        }

        return await WhatsAppBotService.handleWithdrawAssetAction(phoneParams, supportedAsset);
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

            default:
                return {
                    command: commandName,
                    params: {},
                };
        }
    }
}

export default BotCommandHandler;
