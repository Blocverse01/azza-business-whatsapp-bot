import {
    BankBeneficiary,
    MobileMoneyBeneficiary,
    UsersBeneficiaries,
} from '@/app/FiatRamp/fiatRampSchema';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import SumSubService from '@/app/SumSub/SumSubService';
import { UserAssetInfo, UserAssetItem } from '@/app/User/userSchema';
import UserService from '@/app/User/UserService';
import { sendMessageUsingGo } from '@/app/WhatsAppBot/helpers';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import { Message } from '@/app/WhatsAppBot/WhatsAppBotController';
import { PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import WhatsAppBotAddBeneficiaryFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotAddBeneficiaryFlowService';
import WhatsAppBotOffRampFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotOffRampFlowService';
import WhatsAppBotOnRampFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotOnRampFlowService';
import WhatsAppBotSetupTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotSetupTransactionPinFlowService';
import WhatsAppBotTransferToWalletFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransferToWalletFlowService';
import {
    canAccessFeature,
    ENABLED_ASSETS,
    FeatureAccessLevel,
    getAssetConfigOrThrow,
} from '@/config/whatsAppBot';
import env from '@/constants/env';
import { TWO } from '@/constants/numbers';
import {
    SELL_ASSET_DESTINATION_CHOICE_REGEX,
    SELL_ASSET_TO_BENEFICIARY_REGEX_PATTERN,
    TRADE_ASSET_REGEX,
} from '@/constants/regex';
import { INTERNAL_SERVER_ERROR, OK } from '@/constants/status-codes';
import { HttpException } from '@/resources/exceptions/HttpException';
import logger, { logSync } from '@/resources/logger';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import { generateAssetBalanceMessage, getNetworkEmoji } from '@/resources/utils/bot-message-utils';
import {
    getCountryFlagEmoji,
    getUserCountryCodeFromPhoneNumberOrThrow,
    prettifyNumber,
} from '@/resources/utils/currency';
import {
    convertBase64ToAsciiString,
    decryptRequest,
    encryptResponse,
} from '@/resources/utils/encryption';
import axios from 'axios';
import { CountryCode } from 'libphonenumber-js';
import { request } from 'undici';
import * as zlib from 'node:zlib';
import {
    ASSET_ACTION_REGEX_PATTERN,
    AssetInteractiveButtonIds,
    assetInteractiveButtonsIds,
    BaseInteractiveButtonIds,
    ExploreAssetActions,
    FlowNfmReplyResponse,
    InteractiveButtonReplyTypes,
    InteractiveListReplyTypes,
    manageAssetActions,
    MORE_CURRENCIES_COMMAND_REGEX_PATTERN,
    PhoneNumberParams,
    TriggerOfframpFromAddBeneficiaryActionParams,
    WhatsAppInteractiveMessage,
    WhatsAppMessageType,
    WhatsAppTextMessage,
} from './WhatsAppBotType';

class WhatsAppBotService {
    private static readonly WA_BUSINESS_PHONE_NUMBER = env.WA_PHONE_NUMBER_ID;
    private static readonly SHOULD_REQUEST_KYC_FOR_OFFRAMP = true;
    private static readonly USE_SENDER_SCRIPT = true;

    private static getRequestConfig() {
        return {
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                Authorization: `Bearer ${env.CLOUD_API_ACCESS_TOKEN}`,
            },
        };
    }

    public static async sendMessageUsingGo(businessPhoneNumberId: string, message: object) {
        try {
            console.time('sendWhatsappMessage::Go');
            const response = await sendMessageUsingGo({
                message: JSON.stringify(message),
                token: env.CLOUD_API_ACCESS_TOKEN,
                url: env.CLOUD_API_URL,
                id: businessPhoneNumberId,
            });
            console.timeEnd('sendWhatsappMessage::Go');

            if (response.statusCode !== OK) {
                await logServiceError(
                    new HttpException(
                        response.statusCode,
                        'Error sending message',
                        response.responseBody
                    ),
                    'Error sending message'
                );

                return;
            }

            void logger.info('Message sent successfully', {
                response,
            });
        } catch (error) {
            await logServiceError(error, 'Error sending message');
            throw error;
        }
    }

    public static async sendMessageUsingApi(businessPhoneNumberId: string, message: object) {
        const endpoint = `${businessPhoneNumberId}/messages`;

        try {
            const requestOptions = this.getRequestConfig();
            const compressedData = zlib.gzipSync(JSON.stringify(message));

            console.time('sendWhatsappMessage');
            const response = await request(`${env.CLOUD_API_URL}/${endpoint}`, {
                method: 'POST',
                headers: {
                    ...requestOptions.headers,
                    'Content-Encoding': 'gzip',
                },
                body: compressedData,
            });
            console.timeEnd('sendWhatsappMessage');

            const responseData = await response.body.json();

            if (response.statusCode !== OK) {
                await logServiceError(
                    new HttpException(response.statusCode, 'Error sending message', responseData),
                    'Error sending message'
                );

                return;
            }

            void logger.info('Message sent successfully', {
                responseData,
            });
        } catch (error) {
            await logServiceError(error, 'Error sending message');
            throw error;
        }
    }

    public static async sendWhatsappMessage(businessPhoneNumberId: string, data: object) {
        if (this.USE_SENDER_SCRIPT) {
            console.log({ data });
            return await this.sendMessageUsingGo(businessPhoneNumberId, data);
        }

        return await this.sendMessageUsingApi(businessPhoneNumberId, data);
    }

    /**
     * This message is sent immediately after a user onboards on the board and has created a wallet.
     */
    public static async sendSetTransactionPinMessage(
        phoneParams: PhoneNumberParams,
        existingUser?: {
            displayName: string;
        }
    ) {
        const message = WhatsAppBotSetupTransactionPinFlowService.withPhoneNumberId(
            phoneParams.businessPhoneNumberId as PhoneNumberId
        ).createSetupTransactionPinFlowMessage({
            messageBody: existingUser
                ? `Welcome back ${existingUser.displayName}!\n🔐We've improved security on your wallet. Please set up a transaction pin to secure your account.`
                : '🎉You have successfully created a wallet.\n🔐Please set up a transaction pin to secure your account.',
            messageRecipient: phoneParams.userPhoneNumber,
        });

        await this.sendWhatsappMessage(phoneParams.businessPhoneNumberId, message);
    }

    public static async listWalletAddressMessage(
        businessPhoneNumberId: string,
        displayName: string,
        recipient: string,
        walletAssets: Array<UserAssetItem>,
        accountType: string
    ) {
        const text =
            accountType === 'new_account'
                ? `Congrats ${displayName}, welcome aboard 🎉\n\nWe've created decentralized wallets for you. It's like opening a digital piggy bank! 🐷💰.\n\nClick on manage assets to display your assets`
                : `Click on manage assets to display your assets`;

        const interactiveListMessage: WhatsAppInteractiveMessage =
            MessageGenerators.generateInteractiveListMessage({
                recipient,
                listItems: walletAssets.map((asset) => ({
                    id: asset.listItemId,
                    title: `${getNetworkEmoji(asset.network)} ${asset.name} (${asset.network})`,
                    description: `${asset.name} on ${asset.network}`,
                })),
                bodyText: text,
                headerText: 'Manage Your Assets',
                actionButtonText: 'Manage Assets',
            });
        await this.sendWhatsappMessage(businessPhoneNumberId, interactiveListMessage);
    }

    public static async offrampDestinationChoiceMessage(
        phoneParams: PhoneNumberParams,
        assetId: string,
        countryIdentifier: string
    ) {
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;

        const interactiveButtonMessage = MessageGenerators.generateInteractiveButtonMessage({
            recipient: userPhoneNumber,
            bodyText: 'Do you want to choose an existing beneficiary or add a new one?',
            replyButtons: [
                {
                    id: `sell:${assetId}|beneficiaryAction:chooseExisting|countryCode:${countryIdentifier}`,
                    title: 'Choose Existing',
                },
                {
                    id: `sell:${assetId}|beneficiaryAction:addNew|countryCode:${countryIdentifier}`,
                    title: 'Add New',
                },
            ],
        });

        await this.sendWhatsappMessage(businessPhoneNumberId, interactiveButtonMessage);
    }

    public static async listBeneficiaryMessage(
        businessPhoneNumberId: string,
        recipient: string,
        usersBeneficiaries: UsersBeneficiaries,
        assetId: string,
        countryCode: CountryCode
    ) {
        if (usersBeneficiaries.length === 0) {
            await this.beginAddBeneficiaryFlowMessage({
                assetId,
                countryCode: countryCode,
                userPhoneNumber: recipient,
                businessPhoneNumberId,
                messageBody: `You don't have any beneficiaries for ${getCountryFlagEmoji(countryCode)} ${countryCode} yet. Let's add one.`,
            });

            return;
        }
        const interactiveMessageList = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipient,
            type: 'interactive',
            interactive: {
                type: 'list',
                body: {
                    text: 'Select a beneficiary by clicking the button below.',
                },
                header: {
                    type: 'text',
                    text: 'Choose a Beneficiary',
                },
                action: {
                    button: 'Beneficiaries',
                    sections: [
                        {
                            rows: usersBeneficiaries.map((beneficiary) => {
                                let title: string;
                                let description: string;

                                if ((beneficiary as MobileMoneyBeneficiary).firstName) {
                                    const mobileMoneyBeneficiaryCast =
                                        beneficiary as MobileMoneyBeneficiary;
                                    title = `${mobileMoneyBeneficiaryCast.firstName} ${mobileMoneyBeneficiaryCast.lastName}`;
                                    description = `Provider: ${mobileMoneyBeneficiaryCast.mobileProvider}\nMobile Number: ${mobileMoneyBeneficiaryCast.mobileNumber}`;
                                } else {
                                    const bankBeneficiaryCast = beneficiary as BankBeneficiary;
                                    title = `${bankBeneficiaryCast.accountName}`;
                                    description = `Bank Name: ${bankBeneficiaryCast.bankName}\nAccount Number: ${bankBeneficiaryCast.accountNumber}`;
                                }
                                return {
                                    id: `sell:${assetId}|beneficiaryId:${beneficiary.id}`,
                                    // if title is more than 24 characters, truncate with ...
                                    title: title.length > 24 ? `${title.slice(0, 21)}...` : title,
                                    description: description,
                                };
                            }),
                        },
                    ],
                },
            },
        };

        await this.sendWhatsappMessage(businessPhoneNumberId, interactiveMessageList);
    }

    public static async walletDetailsMessage(
        businessPhoneNumberId: string,
        recipient: string,
        userAssetInfo: UserAssetInfo
    ) {
        const { usdDisplayBalance, listItemId, tokenBalanceDisplay, assetName, assetNetwork } =
            userAssetInfo;

        const assetConfig = getAssetConfigOrThrow(listItemId);
        const actionsToDisplay = manageAssetActions.filter((action) =>
            assetConfig.supportedAssetActions.includes(action.action)
        );

        const interactiveListMessage = MessageGenerators.generateInteractiveListMessage({
            recipient,
            listItems: actionsToDisplay.map((assetAction) => ({
                id: `${assetAction.action}:${listItemId}`,
                title: assetAction.text,
                description: assetAction.description,
            })),
            bodyText: `\n- *💰Balance:* ${tokenBalanceDisplay} ${assetName}\n- *💰USD Value:* ${usdDisplayBalance}`,
            headerText: `${getNetworkEmoji(assetNetwork)} ${assetName} (${assetNetwork})`,
            actionButtonText: 'Manage Asset',
        });

        await this.sendWhatsappMessage(businessPhoneNumberId, interactiveListMessage);
    }

    public static async createWalletMessage(
        businessPhoneNumberId: string,
        displayName: string,
        recipient: string
    ) {
        const interactiveMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'button',
                body: {
                    text: `Hi ${displayName}! Ready to get started? Let us create a wallet for you.`,
                },
                action: {
                    buttons: [
                        {
                            type: 'reply',
                            reply: {
                                id: BaseInteractiveButtonIds.CREATE_WALLET,
                                title: "Let's go 🚀",
                            },
                        },
                    ],
                },
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipient,
        };
        await this.sendWhatsappMessage(businessPhoneNumberId, interactiveMessage);
    }

    public static async markMassageAsRead(businessPhoneNumberId: string, messageId: string) {
        const endpoint = `${businessPhoneNumberId}/messages`;
        const data = {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
        };

        try {
            const requestOptions = this.getRequestConfig();
            const response = await axios.post(
                `${env.CLOUD_API_URL}/${endpoint}`,
                data,
                requestOptions
            );

            logSync('debug', 'Message marked as read successfully:', response.data);
        } catch (error) {
            await logServiceError(error, 'Error marking message as read:');
        }
    }

    public static async beginAddBeneficiaryFlowMessage(
        params: PhoneNumberParams & {
            assetId: string;
            countryCode: CountryCode;
            messageBody?: string;
        }
    ) {
        const { assetId, countryCode, userPhoneNumber, businessPhoneNumberId, messageBody } =
            params;

        const asset = getAssetConfigOrThrow(assetId);
        const { paymentChannels } = await FiatRampService.getPaymentMethods(countryCode, 'offramp');

        const accountTypes = paymentChannels.map((channel) => ({
            id: channel.channelId,
            title: FiatRampService.formatPaymentMethodName(channel.channelName, 'offramp'),
        }));

        const flowMessage =
            WhatsAppBotAddBeneficiaryFlowService.generateAddBeneficiaryFlowInitMessage({
                asset,
                countryCode,
                recipient: userPhoneNumber,
                accountTypes,
                bodyText: messageBody,
            });

        await this.sendWhatsappMessage(businessPhoneNumberId, flowMessage);
    }

    public static async beginOffRampFlowMessage(params: {
        businessPhoneNumberId: string;
        recipient: string;
        beneficiaryId: string;
        assetId: string;
    }) {
        const { assetId, beneficiaryId, recipient, businessPhoneNumberId } = params;

        const [asset, beneficiary] = await Promise.all([
            UserService.getUserAssetInfo(recipient, assetId),
            FiatRampService.getBeneficiary(beneficiaryId),
        ]);

        const { rate, fee } = await FiatRampService.getQuotes(
            beneficiary.country.currencySymbol,
            beneficiary.country.code as CountryCode,
            'offramp'
        );

        const flowMessage = WhatsAppBotOffRampFlowService.generateOffRampFlowInitMessage({
            asset,
            beneficiary,
            recipient,
            fiatConversionRate: rate,
            transactionFee: fee,
        });

        await this.sendWhatsappMessage(businessPhoneNumberId, flowMessage);
    }

    public static async ratesCommandHandler(
        userPhoneNumber: string,
        businessPhoneNumberId: string
    ) {
        const rates = await FiatRampService.getAllRates();

        const userCountryCode = getUserCountryCodeFromPhoneNumberOrThrow(userPhoneNumber);
        const userCountry = rates.find(
            (rate) => rate.locale.toLowerCase() === userCountryCode.toLowerCase()
        );
        const userCountryIndex = userCountry ? rates.indexOf(userCountry) : undefined;

        if (userCountryIndex !== undefined && userCountryIndex >= 0 && userCountry) {
            rates.splice(userCountryIndex, 1);
            rates.unshift(userCountry);
        }

        const messagePayload: WhatsAppTextMessage = {
            type: WhatsAppMessageType.TEXT,
            text: {
                body: `_*Conversion Rates*_\n\n${rates.map((rate) => `${getCountryFlagEmoji(rate.locale)} ${rate.code}/USD\nBuy: ${prettifyNumber(rate.buy, TWO)}\nSell: ${prettifyNumber(rate.sell, TWO)}\n--------------------------`).join('\n')}`,
                preview_url: false,
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: userPhoneNumber,
        };

        await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, messagePayload);
    }

    public static async depositAssetCommandHandler(
        userPhoneNumber: string,
        businessPhoneNumberId: string,
        listItemId: string
    ) {
        console.time('depositAssetCommandHandler::getUserAssetWalletOrThrow');
        const asset = await UserService.getUserAssetWalletOrThrow(userPhoneNumber, listItemId);
        console.timeEnd('depositAssetCommandHandler::getUserAssetWalletOrThrow');

        const messagePayload: WhatsAppTextMessage = {
            type: WhatsAppMessageType.TEXT,
            text: {
                body: `${asset.walletAddress}`,
                preview_url: false,
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: userPhoneNumber,
        };

        await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, messagePayload);

        const guideMessage = MessageGenerators.generateTextMessage(
            userPhoneNumber,
            `Steps to deposit ${asset.name} (${asset.network}):\n\n1. Copy the wallet address above 👆\n2. Go to your wallet or exchange where you have ${asset.name} on ${asset.network} and send the desired amount to the copied address.`
        );

        await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, guideMessage);
    }

    public static determineInteractiveButtonReplyAction(
        interactiveButtonId: string
    ): InteractiveButtonReplyTypes {
        if (interactiveButtonId === BaseInteractiveButtonIds.CREATE_WALLET) {
            return 'create-wallet';
        }

        if (interactiveButtonId.match(SELL_ASSET_DESTINATION_CHOICE_REGEX)) {
            return 'sell-asset-destination-choice';
        }

        if (assetInteractiveButtonsIds.includes(interactiveButtonId as AssetInteractiveButtonIds)) {
            return 'explore-asset';
        }

        throw new HttpException(
            INTERNAL_SERVER_ERROR,
            'No configured response action for interactive button reply',
            { interactiveButtonId }
        );
    }

    public static determineInteractiveListReplyAction(
        interactiveListReplyId: string
    ): InteractiveListReplyTypes {
        if (
            assetInteractiveButtonsIds.includes(interactiveListReplyId as AssetInteractiveButtonIds)
        ) {
            return 'explore-asset';
        }

        if (interactiveListReplyId.match(TRADE_ASSET_REGEX)) {
            return 'trade-asset-with-currency';
        }

        if (interactiveListReplyId.match(ASSET_ACTION_REGEX_PATTERN)) {
            return 'explore-asset-action';
        }

        if (interactiveListReplyId.match(MORE_CURRENCIES_COMMAND_REGEX_PATTERN)) {
            return 'return-more-currencies';
        }

        if (interactiveListReplyId.match(SELL_ASSET_TO_BENEFICIARY_REGEX_PATTERN)) {
            return 'trigger-offramp-flow';
        }

        throw new HttpException(
            INTERNAL_SERVER_ERROR,
            'No configured response action for interactive list reply',
            { interactiveListReplyId }
        );
    }

    public static determineInteractiveNfmReplyAction(
        nfmReply: Required<Message['interactive']>['nfm_reply']
    ) {
        const { name, response_json } = nfmReply;
        const response = JSON.parse(response_json);

        if (name === 'flow') {
            const flowResponse = response as FlowNfmReplyResponse;
            const flowResponseParams = flowResponse.wa_flow_response_params;

            const flowIsAddBeneficiary = flowResponseParams
                ? flowResponseParams.flow_name.toLowerCase().includes('add beneficiary')
                : 'asset_id' in flowResponse && 'beneficiary_id' in flowResponse;

            if (flowIsAddBeneficiary) {
                const addBeneficiaryFlowResponse = response as FlowNfmReplyResponse<{
                    asset_id: string;
                    beneficiary_id: string;
                }>;
                return {
                    action: 'trigger-offramp-flow',
                    data: {
                        assetId: addBeneficiaryFlowResponse.asset_id,
                        beneficiaryId: addBeneficiaryFlowResponse.beneficiary_id,
                    },
                } satisfies TriggerOfframpFromAddBeneficiaryActionParams;
            }
        }

        throw new HttpException(
            INTERNAL_SERVER_ERROR,
            'No configured response action for nfm reply',
            { nfmReply }
        );
    }

    private static async sendKycVerificationUrlMessage(phoneParams: PhoneNumberParams) {
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;
        const kycUrl = await SumSubService.generateKycUrl(userPhoneNumber);

        const message = MessageGenerators.generateInteractiveCtaUrlButtonMessage({
            recipient: userPhoneNumber,
            bodyText: `Please click on the link to verify your identity.\n\nYou will need a valid ID handy to complete the KYC step`,
            headerText: `Submit KYC details`,
            ctaUrl: kycUrl,
            ctaText: 'Submit KYC details',
        });

        await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, message);
    }

    public static async sendSelectSupportedCurrenciesMessage(
        phoneParams: PhoneNumberParams,
        assetActionId: Extract<ExploreAssetActions, 'buy' | 'sell'>,
        purchaseAssetId: AssetInteractiveButtonIds,
        _sliceFrom = 0,
        _sliceTo = 9
    ) {
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;

        const userCountryCode = getUserCountryCodeFromPhoneNumberOrThrow(userPhoneNumber);
        const supportedCurrencies = await FiatRampService.getSupportedCurrencies();

        const userCountry = supportedCurrencies.find(
            (country) => country.code.toLowerCase() === userCountryCode.toLowerCase()
        );
        const userCountryIndex = userCountry ? supportedCurrencies.indexOf(userCountry) : undefined;

        const userCountryIsSupported = userCountryIndex !== undefined && userCountryIndex >= 0;

        // If the user's country is supported, move it to the beginning of the array
        if (userCountryIsSupported && userCountry) {
            supportedCurrencies.splice(userCountryIndex, 1);
            supportedCurrencies.unshift(userCountry);
        }

        // determine sliceFrom considering _sliceFrom and the available indexes of the array
        const sliceFrom = Math.min(_sliceFrom, supportedCurrencies.length - 1);
        // determine sliceTo considering _sliceTo and the available indexes of the array
        const sliceTo = Math.min(_sliceTo, supportedCurrencies.length);

        // determine if there should be a nextSliceFrom
        const nextSliceFrom = sliceTo < supportedCurrencies.length ? sliceTo : null;
        // determine if there should be a nextSliceTo
        const nextSliceTo = nextSliceFrom ? nextSliceFrom + 9 : null;

        const moreListItem =
            nextSliceFrom && nextSliceTo
                ? {
                      id: `moreCurrencies|${assetActionId}:${purchaseAssetId}|nextSliceFrom:${nextSliceFrom}|nextSliceTo:${nextSliceTo}`,
                      title: 'More',
                  }
                : null;

        const countriesToDisplay = supportedCurrencies.slice(sliceFrom, sliceTo);

        const page = Math.floor(sliceFrom / 9) + 1;

        const shouldShowCurrentPageNumber = supportedCurrencies.length > 9;

        const interactiveMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'list',
                body: {
                    text: "Click on 'Currencies' to select your local currency.",
                },
                header: {
                    type: 'text',
                    text: `Select Your Local Currency${shouldShowCurrentPageNumber ? ` - Page ${page}` : ''}`,
                },
                action: {
                    button: 'Currencies',
                    sections: [
                        {
                            rows: [
                                ...countriesToDisplay.map((country) => {
                                    return {
                                        id: `${assetActionId}:${purchaseAssetId}|currency:${country.currencySymbol}|countryCode:${country.code}`,
                                        title: `${getCountryFlagEmoji(country.code)} ${country.name}`,
                                        description: `Currency: ${country.currencySymbol}`,
                                    };
                                }),
                                // Add moreListItem only if it's not null
                                ...(moreListItem ? [moreListItem] : []),
                            ],
                        },
                    ],
                },
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: userPhoneNumber,
        };

        await this.sendWhatsappMessage(businessPhoneNumberId, interactiveMessage);
    }

    private static async sendKycInReviewMessage(phoneParams: PhoneNumberParams) {
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;

        const messagePayload: WhatsAppTextMessage = {
            type: WhatsAppMessageType.TEXT,
            text: {
                body: `Your KYC is currently under review. We'll notify you once it's completed.`,
                preview_url: false,
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: userPhoneNumber,
        };

        await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, messagePayload);
    }

    public static async handleBuyAssetAction(
        phoneParams: PhoneNumberParams,
        assetId: AssetInteractiveButtonIds,
        userFeatureAccessLevel: FeatureAccessLevel
    ) {
        if (
            !FiatRampService.SERVICE_ENABLED ||
            !canAccessFeature(userFeatureAccessLevel, FeatureAccessLevel.STAGING)
        ) {
            return await this.sendArbitraryTextMessage(
                phoneParams.userPhoneNumber,
                "Sorry, we are currently maintaining our onramp services. We'd let you know once this service is back up."
            );
        }

        const { userPhoneNumber } = phoneParams;

        if (SumSubService.SERVICE_IS_ACTIVE) {
            const userKycStatus = await UserService.getUserKycStatus(userPhoneNumber);

            if (
                userKycStatus === 'unverified' ||
                userKycStatus === 'rejected' ||
                userKycStatus === 'pending'
            ) {
                await this.sendKycVerificationUrlMessage(phoneParams);
                return;
            }

            if (userKycStatus === 'in_review') {
                await WhatsAppBotService.sendKycInReviewMessage(phoneParams);
                return;
            }
        }

        await this.sendSelectSupportedCurrenciesMessage(
            phoneParams,
            ExploreAssetActions.BUY_ASSET,
            assetId
        );
    }

    public static async handleSellAssetAction(
        phoneParams: PhoneNumberParams,
        assetId: AssetInteractiveButtonIds,
        userFeatureAccessLevel: FeatureAccessLevel
    ) {
        if (
            !FiatRampService.SERVICE_ENABLED ||
            !canAccessFeature(userFeatureAccessLevel, FeatureAccessLevel.STAGING)
        ) {
            return await this.sendArbitraryTextMessage(
                phoneParams.userPhoneNumber,
                "Sorry, we are currently maintaining our offramp services. We'd let you know once this service is back up."
            );
        }

        if (SumSubService.SERVICE_IS_ACTIVE && this.SHOULD_REQUEST_KYC_FOR_OFFRAMP) {
            const userKycStatus = await UserService.getUserKycStatus(phoneParams.userPhoneNumber);

            if (
                userKycStatus === 'unverified' ||
                userKycStatus === 'rejected' ||
                userKycStatus === 'pending'
            ) {
                await this.sendKycVerificationUrlMessage(phoneParams);
                return;
            }

            if (userKycStatus === 'in_review') {
                await WhatsAppBotService.sendKycInReviewMessage(phoneParams);
                return;
            }
        }

        await this.sendSelectSupportedCurrenciesMessage(
            phoneParams,
            ExploreAssetActions.SELL_ASSET,
            assetId
        );
    }

    public static async handleWithdrawAssetAction(
        phoneParams: PhoneNumberParams,
        assetId: AssetInteractiveButtonIds
    ) {
        const { userPhoneNumber } = phoneParams;
        const assetInfo = await UserService.getUserAssetInfo(userPhoneNumber, assetId);

        const message = WhatsAppBotTransferToWalletFlowService.generateTransferToWalletInitMessage({
            recipient: userPhoneNumber,
            asset: assetInfo,
        });

        await this.sendWhatsappMessage(phoneParams.businessPhoneNumberId, message);
    }

    public static async beginOnrampFlowMessage(
        phoneParams: PhoneNumberParams,
        params: {
            assetId: AssetInteractiveButtonIds;
            currencySymbol: string;
            countryCode: string;
        }
    ) {
        const { userPhoneNumber } = phoneParams;
        const { assetId, currencySymbol, countryCode } = params;

        const asset = getAssetConfigOrThrow(assetId);

        const { paymentChannels } = await FiatRampService.getPaymentMethods(
            countryCode as CountryCode,
            'onramp'
        );

        const paymentMethods = paymentChannels.map((channel) => ({
            id: channel.channelId,
            title: FiatRampService.formatPaymentMethodName(channel.channelName, 'onramp'),
        }));

        if (paymentMethods.length === 0) {
            await this.sendArbitraryTextMessage(
                userPhoneNumber,
                `Sorry, we currently do not support buying crypto for ${currencySymbol}.`
            );
        }

        const flowMessage = WhatsAppBotOnRampFlowService.generateOnRampFlowInitMessage({
            recipient: userPhoneNumber,
            asset,
            localCurrency: currencySymbol,
            countryCode,
            paymentMethods,
        });

        await this.sendWhatsappMessage(phoneParams.businessPhoneNumberId, flowMessage);
    }

    public static async sendKycVerifiedMessage(userPhoneNumber: string) {
        const messagePayload: WhatsAppTextMessage = MessageGenerators.generateTextMessage(
            userPhoneNumber,
            `Your KYC has been successfully verified🎉\nYou now have access to all functionalities`
        );

        await WhatsAppBotService.sendWhatsappMessage(this.WA_BUSINESS_PHONE_NUMBER, messagePayload);
    }

    public static async sendKycRejectedMessage(userPhoneNumber: string) {
        const messagePayload: WhatsAppTextMessage = MessageGenerators.generateTextMessage(
            userPhoneNumber,
            `Your KYC has been rejected. Please re-verify your identity.`
        );

        await WhatsAppBotService.sendWhatsappMessage(this.WA_BUSINESS_PHONE_NUMBER, messagePayload);
    }

    public static decryptFlowRequest(body: Record<string, string>) {
        const privatePem = convertBase64ToAsciiString(env.WA_FLOW_PRIVATE_KEY);

        return decryptRequest(body, privatePem, env.WA_FLOW_PRIVATE_KEY_SEED_PHRASE);
    }

    public static encryptFlowResponse(
        response: unknown,
        buffers: {
            aesKeyBuffer: Buffer;
            initialVectorBuffer: Buffer;
        }
    ) {
        const { aesKeyBuffer, initialVectorBuffer } = buffers;

        return encryptResponse(response, aesKeyBuffer, initialVectorBuffer);
    }

    public static async sendArbitraryTextMessage(userPhoneNumber: string, message: string) {
        const messagePayload: WhatsAppTextMessage = MessageGenerators.generateTextMessage(
            userPhoneNumber,
            message
        );

        await WhatsAppBotService.sendWhatsappMessage(this.WA_BUSINESS_PHONE_NUMBER, messagePayload);
    }

    public static async getUserCountryFromPhoneNumber(userPhoneNumber: string) {
        if (!FiatRampService.SERVICE_ENABLED) {
            return undefined;
        }

        const supportedCountries = await FiatRampService.getSupportedCurrencies();
        const userCountryCode = getUserCountryCodeFromPhoneNumberOrThrow(userPhoneNumber);

        return supportedCountries.find(
            (country) => country.code.toLowerCase() === userCountryCode.toLowerCase()
        );
    }

    public static async handleUserAssetBalanceQuery(
        phoneParams: PhoneNumberParams,
        assetItemId: string
    ) {
        await this.sendArbitraryTextMessage(
            phoneParams.userPhoneNumber,
            'Fetching your balance... Sit tight!'
        );

        const [userCountry, userAssetInfo] = await Promise.all([
            this.getUserCountryFromPhoneNumber(phoneParams.userPhoneNumber),
            UserService.getUserAssetInfo(phoneParams.userPhoneNumber, assetItemId),
        ]);

        if (!userCountry) {
            return await this.sendUserBalancesMessage(phoneParams, [userAssetInfo]);
        }

        const sellRate = await FiatRampService.getSellRate(userCountry.currencySymbol);

        const fiatConfig = {
            conversionRate: sellRate,
            localCurrencySymbol: userCountry.currencySymbol,
            countryCode: userCountry.code,
        };

        await this.sendUserBalancesMessage(phoneParams, [userAssetInfo], fiatConfig);
    }

    public static async handleUserBalancesQuery(
        phoneParams: PhoneNumberParams,
        entityConfig: {
            asset?: string;
            network?: string;
        } = {}
    ) {
        const { asset: tokenName, network } = entityConfig;

        await this.sendArbitraryTextMessage(
            phoneParams.userPhoneNumber,
            'Fetching your balances... Sit tight!'
        );

        const supportedAssetIds = ENABLED_ASSETS.filter((asset) => {
            // filter for assetName | network or assetName && network
            return (
                (tokenName ? asset.tokenName.toLowerCase() === tokenName.toLowerCase() : true) &&
                (network ? asset.network.toLowerCase() === network.toLowerCase() : true)
            );
        }).map((asset) => asset.listItemId);

        const promises = supportedAssetIds.map((assetId) =>
            UserService.getUserAssetInfo(phoneParams.userPhoneNumber, assetId)
        );

        const [userCountry, ...userAssetsInfo] = await Promise.all([
            this.getUserCountryFromPhoneNumber(phoneParams.userPhoneNumber),
            ...promises,
        ]);

        if (!userCountry) {
            return await this.sendUserBalancesMessage(phoneParams, userAssetsInfo);
        }

        const sellRate = await FiatRampService.getSellRate(userCountry.currencySymbol);

        const fiatConfig = {
            conversionRate: sellRate,
            localCurrencySymbol: userCountry.currencySymbol,
            countryCode: userCountry.code,
        };

        await this.sendUserBalancesMessage(phoneParams, userAssetsInfo, fiatConfig);
    }

    public static async sendUserBalancesMessage(
        phoneParams: PhoneNumberParams,
        assetsInfo: UserAssetInfo[],
        fiatConfig?: {
            conversionRate: number;
            localCurrencySymbol: string;
            countryCode: string;
        }
    ) {
        // The fiat conversionRate assumes all the assets are stable coins so, in the event of non-stable-coin assets, it has to be refactored.
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;

        const userBalancesMessage = assetsInfo.map((assetInfo) => {
            return generateAssetBalanceMessage(assetInfo, fiatConfig);
        });

        const message = `*💰 Your Wallet Balances  💰*\n\n${userBalancesMessage.join('\n\n')}`;

        const messagePayload: WhatsAppTextMessage = MessageGenerators.generateTextMessage(
            userPhoneNumber,
            message
        );
        await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, messagePayload);
    }
}

export default WhatsAppBotService;
