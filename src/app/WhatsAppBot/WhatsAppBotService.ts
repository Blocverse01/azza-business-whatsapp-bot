import { AssetBalance } from '@/app/AzzaWalletManager/providers/BaseWalletProvider';
import {
    ACKNOWLEDGE_BUTTON_ID_PREFIX,
    MARK_AS_PAID_BUTTON_ID_PREFIX,
} from '@/app/FiatRamp/alternatives/config';
import {
    BankBeneficiary,
    MobileMoneyBeneficiary,
    UsersBeneficiaries,
} from '@/app/FiatRamp/fiatRampSchema';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import SumSubService, {
    DEFAULT_KYC_LEVEL_NAME,
    NG_KYC_LEVEL_NAME,
} from '@/app/SumSub/SumSubService';
import { UserAssetItem } from '@/app/User/userSchema';
import { sendMessageUsingGo } from '@/app/WhatsAppBot/helpers';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import {
    getFirstTimeUserMessageText,
    getWalletCreationSuccessMessageText,
} from '@/app/WhatsAppBot/utils';
import { PhoneNumberId } from '@/app/WhatsAppBot/WhatsAppFlows/config';
import WhatsAppBotAddBeneficiaryFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotAddBeneficiaryFlowService';
import WhatsAppBotOffRampFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotOffRampFlowService';
import WhatsAppBotOnRampFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotOnRampFlowService';
import WhatsAppBotSetupTransactionPinFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotSetupTransactionPinFlowService';
import WhatsAppBotTransferToWalletFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransferToWalletFlowService';
import {
    canAccessFeature,
    deriveUserFeatureAccessLevel,
    FeatureAccessLevel,
    getAssetConfigOrThrow,
} from '@/config/whatsAppBot';
import env from '@/constants/env';
import { SIX, TWO } from '@/constants/numbers';
import {
    SELL_ASSET_DESTINATION_CHOICE_REGEX,
    SELL_ASSET_TO_BENEFICIARY_REGEX_PATTERN,
    TRADE_ASSET_REGEX,
} from '@/constants/regex';
import { INTERNAL_SERVER_ERROR, OK } from '@/constants/status-codes';
import { UserV2Record } from '@/db/xata';
import { HttpException } from '@/resources/exceptions/HttpException';
import { logServiceError } from '@/resources/requestHelpers/handleRequestError';
import {
    generateAssetBalanceMessageV2,
    getNetworkEmoji,
} from '@/resources/utils/bot-message-utils';
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
import userServiceV2 from '@/runtime/user';
import azzaWalletManager from '@/runtime/wallet';
import axios from 'axios';
import { CountryCode } from 'libphonenumber-js';
import * as zlib from 'node:zlib';
import { FormData, request } from 'undici';
import {
    ASSET_ACTION_REGEX_PATTERN,
    AssetInteractiveButtonIds,
    assetInteractiveButtonsIds,
    BaseInteractiveButtonIds,
    ExploreAssetActions,
    FlowNfmReplyResponse,
    IncomingWhatsappMessage,
    InteractiveButtonReplyTypes,
    InteractiveListReplyTypes,
    manageAssetActions,
    MORE_BENEFICIARIES_COMMAND_REGEX_PATTERN,
    MORE_CURRENCIES_COMMAND_REGEX_PATTERN,
    PhoneNumberParams,
    TriggerOfframpFromAddBeneficiaryActionParams,
    WhatsAppInteractiveMessage,
    WhatsAppMessageType,
    WhatsAppTextMessage,
} from './WhatsAppBotType';
import SmileIdService from '../SmileID/SmileIdService';
import FeatureFlagService from '../FeatureFlag/FeatureFlagService';
import { FeatureFlagKey } from '../FeatureFlag/feature-flag-schema';
import { generateRatesCard } from '../rate-card/generators';
import { getDefaultParamsForNetworkFeeQuery } from '../AzzaWalletManager/fallback-data';
import cryptoAssetPriceService from '@/runtime/crypto-asset-price';

class WhatsAppBotService {
    private static readonly WA_BUSINESS_PHONE_NUMBER = env.WA_PHONE_NUMBER_ID;
    private static readonly SHOULD_REQUEST_KYC_FOR_OFFRAMP = true;
    private static readonly USE_SENDER_SCRIPT = false;

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
            const response = await sendMessageUsingGo({
                message: JSON.stringify(message),
                token: env.CLOUD_API_ACCESS_TOKEN,
                url: env.CLOUD_API_URL,
                id: businessPhoneNumberId,
            });

            if (response.statusCode !== OK) {
                await logServiceError(
                    new HttpException(response.statusCode, 'Error sending message', {
                        response: response.responseBody,
                        message,
                    }),
                    'Error sending message'
                );

                return;
            }
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

            const response = await request(`${env.CLOUD_API_URL}/${endpoint}`, {
                method: 'POST',
                headers: {
                    ...requestOptions.headers,
                    'Content-Encoding': 'gzip',
                },
                body: compressedData,
            });

            const responseData = await response.body.json();

            console.log(responseData);

            if (response.statusCode !== OK) {
                const error = new HttpException(response.statusCode, 'Error sending message', {
                    responseData,
                    message,
                    businessPhoneNumberId,
                });
                throw error;
            }

            return { sent: true };
        } catch (error) {
            await logServiceError(error, 'Error sending message');
            return { sent: false };
        }
    }

    public static async uploadImageToWhatsapp(businessPhoneNumberId: string, imageFile: File) {
        const endpoint = `${businessPhoneNumberId}/media`;

        const formData = new FormData();

        formData.append('file', imageFile);
        formData.append('messaging_product', 'whatsapp');
        formData.append('type', 'image/png');

        try {
            const requestOptions = this.getRequestConfig();

            const response = await request(`${env.CLOUD_API_URL}/${endpoint}`, {
                method: 'POST',
                headers: {
                    Authorization: requestOptions.headers.Authorization,
                },
                body: formData,
            });

            const responseData = await response.body.json();

            if (response.statusCode !== OK) {
                await logServiceError(
                    new HttpException(response.statusCode, 'Error uploading media', {
                        responseData,
                        payload: formData.values(),
                        businessPhoneNumberId,
                    }),
                    'Error uploading media'
                );

                return null;
            }

            return responseData as {
                id: string;
            };
        } catch (error) {
            await logServiceError(error, 'Error uploading media');
            throw error;
        }
    }

    public static async sendMediaMessage(
        phoneParams: PhoneNumberParams,
        message: {
            mediaId: string;
            caption?: string;
            type: 'image';
        }
    ) {
        const messageObject = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phoneParams.userPhoneNumber,
            type: message.type,
            image: {
                id: message.mediaId,
                caption: message.caption,
            },
        };

        return await this.sendWhatsappMessage(phoneParams.businessPhoneNumberId, messageObject);
    }

    public static async sendWhatsappMessage(businessPhoneNumberId: string, data: object) {
        if (this.USE_SENDER_SCRIPT) {
            return await this.sendMessageUsingGo(businessPhoneNumberId, data);
        }

        return await this.sendMessageUsingApi(businessPhoneNumberId, data);
    }

    /**
     * This message is sent immediately after a user onboards on the board and has created a wallet.
     */
    public static async sendSetTransactionPinMessage(
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        existingUser?: {
            displayName: string;
        }
    ) {
        const message = WhatsAppBotSetupTransactionPinFlowService.withPhoneNumberId(
            phoneParams.businessPhoneNumberId as PhoneNumberId
        ).createSetupTransactionPinFlowMessage(user, {
            messageBody: existingUser
                ? `Welcome back ${existingUser.displayName}!\n🔐We've improved security on your wallet. Please set up a transaction pin to secure your account.`
                : getWalletCreationSuccessMessageText(),
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
                listItems: walletAssets.slice(0, 9).map((asset) => ({
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
        countryCode: CountryCode,
        _sliceFrom = 0,
        _sliceTo = 9
    ) {
        usersBeneficiaries.reverse();

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

        // determine sliceFrom considering _sliceFrom and the available indexes of the array
        const sliceFrom = Math.min(_sliceFrom, usersBeneficiaries.length - 1);
        // determine sliceTo considering _sliceTo and the available indexes of the array
        const sliceTo = Math.min(_sliceTo, usersBeneficiaries.length);

        // determine if there should be a nextSliceFrom
        const nextSliceFrom = sliceTo < usersBeneficiaries.length ? sliceTo : null;
        // determine if there should be a nextSliceTo
        const nextSliceTo = nextSliceFrom ? nextSliceFrom + 9 : null;

        const moreListItem =
            nextSliceFrom && nextSliceTo
                ? ({
                      id: `moreBeneficiaries|${assetId}|${countryCode}|${nextSliceFrom}|${nextSliceTo}`,
                      title: 'More',
                  } as const)
                : null;

        const beneficiariesToDisplay = usersBeneficiaries.slice(sliceFrom, sliceTo);

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
                            rows: [
                                ...beneficiariesToDisplay.map((beneficiary) => {
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
                                        title:
                                            title.length > 24 ? `${title.slice(0, 21)}...` : title,
                                        description: description,
                                    };
                                }),
                                // Add moreListItem only if it's not null
                                ...(moreListItem ? [moreListItem] : []),
                            ],
                        },
                    ],
                },
            },
        };

        await this.sendWhatsappMessage(businessPhoneNumberId, interactiveMessageList);
    }

    public static async walletDetailsMessage(
        phoneParams: PhoneNumberParams,
        userAssetInfo: AssetBalance
    ) {
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;
        const { balance, asset, blockchainNetwork } = userAssetInfo;

        const tokenBalanceDisplay = prettifyNumber(balance, SIX);

        const assetConfig = getAssetConfigOrThrow(asset.listItemId);
        const actionsToDisplay = manageAssetActions.filter((action) =>
            assetConfig.supportedAssetActions.includes(action.action)
        );

        const interactiveListMessage = MessageGenerators.generateInteractiveListMessage({
            recipient: userPhoneNumber,
            listItems: actionsToDisplay.map((assetAction) => ({
                id: `${assetAction.action}:${asset.listItemId}`,
                title: assetAction.text,
                description: assetAction.description,
            })),
            bodyText: `\n- *💰Balance:* ${tokenBalanceDisplay} ${asset.tokenName}`,
            headerText: `${getNetworkEmoji(blockchainNetwork)} ${asset.tokenName} (${blockchainNetwork})`,
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
                    text: getFirstTimeUserMessageText(displayName),
                },
                action: {
                    buttons: [
                        {
                            type: 'reply',
                            reply: {
                                id: BaseInteractiveButtonIds.CREATE_WALLET,
                                title: 'Create wallet 🚀',
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

            console.log(`Message ${messageId}  marked as read`, response.data);
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

    public static async beginOffRampFlowMessage(
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        offrampParams: {
            beneficiaryId: string;
            assetId: string;
        }
    ) {
        const { assetId, beneficiaryId } = offrampParams;
        const { businessPhoneNumberId, userPhoneNumber } = phoneParams;

        const [assetBalance, beneficiary] = await Promise.all([
            azzaWalletManager.getAssetBalance({
                assetId,
                userId: user.id,
            }),
            FiatRampService.getBeneficiary(beneficiaryId),
        ]);

        const { rate, fee } = await FiatRampService.getQuotes(
            beneficiary.country.currencySymbol,
            beneficiary.country.code as CountryCode,
            'offramp'
        );

        const flowMessage = WhatsAppBotOffRampFlowService.generateOffRampFlowInitMessage(user, {
            assetBalance: assetBalance,
            beneficiary,
            recipient: userPhoneNumber,
            fiatConversionRate: rate,
            transactionFee: fee,
            assetUsdPrice: await cryptoAssetPriceService.getAssetPrice(assetBalance.asset, 'USD'),
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

        const ratesText = `_*Conversion Rates*_\n\n${rates.map((rate) => `${getCountryFlagEmoji(rate.locale)} ${rate.code}/USD\nBuy: ${prettifyNumber(rate.buy, TWO)}\nSell: ${prettifyNumber(rate.sell, TWO)}\n--------------------------`).join('\n')}`;

        await this.sendWhatsappMessage(
            businessPhoneNumberId,
            MessageGenerators.generateTextMessage(userPhoneNumber, ratesText)
        );

        try {
            const imageBinary = await generateRatesCard(rates);
            const imageFile = new File([imageBinary], 'rates_card.png', { type: 'image/png' });
            const mediaResponse = await this.uploadImageToWhatsapp(
                businessPhoneNumberId,
                imageFile
            );

            if (!mediaResponse?.id) {
                return;
            }

            await this.sendMediaMessage(
                { userPhoneNumber, businessPhoneNumberId },
                {
                    mediaId: mediaResponse.id,
                    caption: "Here's a beautiful rate card you can share 💙",
                    type: 'image',
                }
            );
        } catch (error) {}
    }

    public static async depositAssetCommandHandler(
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        listItemId: string
    ) {
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;
        const { tokenName, network } = getAssetConfigOrThrow(listItemId);

        console.time('depositAssetCommandHandler::getUserAssetWalletOrThrow');
        const assetWallet = await azzaWalletManager.getUserWallet(user.id, network);
        console.timeEnd('depositAssetCommandHandler::getUserAssetWalletOrThrow');

        const messagePayload: WhatsAppTextMessage = {
            type: WhatsAppMessageType.TEXT,
            text: {
                body: `${assetWallet.address}`,
                preview_url: false,
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: userPhoneNumber,
        };

        await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, messagePayload);

        const guideMessage = MessageGenerators.generateTextMessage(
            userPhoneNumber,
            `☝️That’s your deposit address for ${tokenName} on ${network}:\n- Copy the address carefully. (Tap and hold to copy.)\n- Open your external wallet or exchange.\n- Paste the address and send your ${tokenName}.`
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

        if (interactiveButtonId.startsWith(ACKNOWLEDGE_BUTTON_ID_PREFIX)) {
            return 'acknowledge-manual-offramp-settlement';
        }

        if (interactiveButtonId.startsWith(MARK_AS_PAID_BUTTON_ID_PREFIX)) {
            return 'mark-manual-offramp-settlement-as-paid';
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

        if (interactiveListReplyId.match(MORE_BENEFICIARIES_COMMAND_REGEX_PATTERN)) {
            return 'return-more-beneficiaries';
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
        nfmReply: Required<IncomingWhatsappMessage['interactive']>['nfm_reply']
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

        return null;
    }

    public static async sendKycVerificationUrlMessage(
        user: UserV2Record,
        phoneParams: PhoneNumberParams
    ) {
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;

        const userCountryCode = getUserCountryCodeFromPhoneNumberOrThrow(userPhoneNumber);

        const smileIdIsEnabled = await FeatureFlagService.isFeatureEnabled(
            FeatureFlagKey.SMILE_ID_KYC
        );
        const shouldUseSumsub = !smileIdIsEnabled ? true : !['NG'].includes(userCountryCode);

        const kycUrl = await (async (useSumsub: boolean) => {
            if (useSumsub) {
                const kycLevelName =
                    getUserCountryCodeFromPhoneNumberOrThrow(userPhoneNumber) === 'NG'
                        ? NG_KYC_LEVEL_NAME
                        : DEFAULT_KYC_LEVEL_NAME;
                return await SumSubService.generateKycUrl({
                    userPhoneNumber,
                    levelName: kycLevelName,
                    userId: user.id,
                });
            }

            return await SmileIdService.generateKycLink(user.id);
        })(shouldUseSumsub);

        const message = MessageGenerators.generateInteractiveCtaUrlButtonMessage({
            recipient: userPhoneNumber,
            bodyText: shouldUseSumsub
                ? `Please click on the link to verify your identity.\n\nYou will need a valid ID handy to complete the KYC step`
                : `🚀 Get your KYC done in 2 minutes.\n\nYou will need the following:\n\n- NIN (11-digit number)\n- BVN\n\nClick on the link below to continue.`,
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

        const bodyText =
            assetActionId === ExploreAssetActions.BUY_ASSET
                ? 'Click the button below to select your payment currency'
                : 'Click the button below to select your payout currency';

        const interactiveMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'list',
                body: {
                    text: bodyText,
                },
                header: {
                    type: 'text',
                    text: `Select Your Local Currency${shouldShowCurrentPageNumber ? ` - Page ${page}` : ''}`,
                },
                action: {
                    button: 'Select Currency 💳',
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

    public static async sendKycInReviewMessage(phoneParams: PhoneNumberParams) {
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
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        assetId: AssetInteractiveButtonIds
    ) {
        const userFeatureAccessLevel = deriveUserFeatureAccessLevel(user.FEATURE_ACCESS_LEVEL);

        if (
            !FiatRampService.SERVICE_ENABLED ||
            !canAccessFeature(userFeatureAccessLevel, FeatureAccessLevel.PRODUCTION)
        ) {
            return await this.sendArbitraryTextMessage(
                phoneParams.userPhoneNumber,
                "Sorry, we are currently maintaining our onramp services. We'd let you know once this service is back up."
            );
        }

        if (SumSubService.SERVICE_IS_ACTIVE) {
            const userKycStatus = userServiceV2.formatKycStatus(user.kycStatus);

            if (
                userKycStatus === 'unverified' ||
                userKycStatus === 'rejected' ||
                userKycStatus === 'pending'
            ) {
                await this.sendKycVerificationUrlMessage(user, phoneParams);
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
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        assetId: AssetInteractiveButtonIds
    ) {
        const userFeatureAccessLevel = deriveUserFeatureAccessLevel(user.FEATURE_ACCESS_LEVEL);

        if (
            !FiatRampService.SERVICE_ENABLED ||
            !canAccessFeature(userFeatureAccessLevel, FeatureAccessLevel.PRODUCTION)
        ) {
            return await this.sendArbitraryTextMessage(
                phoneParams.userPhoneNumber,
                "Sorry, we are currently maintaining our offramp services. We'd let you know once this service is back up."
            );
        }

        if (SumSubService.SERVICE_IS_ACTIVE && this.SHOULD_REQUEST_KYC_FOR_OFFRAMP) {
            const userKycStatus = userServiceV2.formatKycStatus(user.kycStatus);

            if (
                userKycStatus === 'unverified' ||
                userKycStatus === 'rejected' ||
                userKycStatus === 'pending'
            ) {
                await this.sendKycVerificationUrlMessage(user, phoneParams);
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
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        assetId: AssetInteractiveButtonIds
    ) {
        const { userPhoneNumber } = phoneParams;
        const assetBalance = await azzaWalletManager.getAssetBalance({
            assetId,
            userId: user.id,
        });
        let withdrawNetworkFee = 0;

        const assetConfig = getAssetConfigOrThrow(assetId);
        if (assetConfig.isNative) {
            const defaultParams = getDefaultParamsForNetworkFeeQuery(assetConfig.network);

            const networkFeeInfo = await azzaWalletManager.getWithdrawNetworkFee({
                amount: defaultParams.amount.toString(),
                recipient: defaultParams.recipient,
                assetId,
                userId: user.id,
            });

            withdrawNetworkFee = networkFeeInfo.networkFee;
        }

        const message = WhatsAppBotTransferToWalletFlowService.generateTransferToWalletInitMessage(
            user,
            {
                recipient: userPhoneNumber,
                assetBalance: assetBalance,
                networkFee: withdrawNetworkFee,
            }
        );

        await this.sendWhatsappMessage(phoneParams.businessPhoneNumberId, message);
    }

    public static async beginOnrampFlowMessage(
        user: UserV2Record,
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

        const flowMessage = WhatsAppBotOnRampFlowService.generateOnRampFlowInitMessage(user, {
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

    public static async sendKycLinkGeneratingMessage(userPhoneNumber: string) {
        const messagePayload: WhatsAppTextMessage = MessageGenerators.generateTextMessage(
            userPhoneNumber,
            `Your KYC link is being generated... Please wait while we process your request. This may take a few seconds.`
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
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        assetItemId: string
    ) {
        await this.sendArbitraryTextMessage(
            phoneParams.userPhoneNumber,
            'Fetching your balance... Sit tight!'
        );

        const [userCountry, userAssetInfo] = await Promise.all([
            this.getUserCountryFromPhoneNumber(phoneParams.userPhoneNumber),
            azzaWalletManager.getAssetBalance({
                userId: user.id,
                assetId: assetItemId,
            }),
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
        user: UserV2Record,
        phoneParams: PhoneNumberParams,
        entityConfig: {
            asset?: string;
            network?: string;
        } = {}
    ) {
        const { asset: tokenName, network } = entityConfig;

        await this.sendWhatsappMessage(
            phoneParams.businessPhoneNumberId,
            MessageGenerators.generateTextMessage(
                phoneParams.userPhoneNumber,
                'Fetching your balances... Sit tight!'
            )
        );

        const supportedAssets = azzaWalletManager.getSupportedAssets().filter((asset) => {
            if (tokenName && network) {
                return (
                    asset.tokenName.toLowerCase() === tokenName.toLowerCase() &&
                    asset.network.toLowerCase() === network.toLowerCase()
                );
            }
            if (tokenName) {
                return asset.tokenName.toLowerCase() === tokenName.toLowerCase();
            }
            if (network) {
                return asset.network.toLowerCase() === network.toLowerCase();
            }

            return true;
        });

        const uniqueNetworks = [...new Set(supportedAssets.map((asset) => asset.network))];
        const allPromises = uniqueNetworks.map((network) =>
            azzaWalletManager.getNetworkBalances(user.id, network)
        );

        const [userCountry, ...userAssetsInfoEntries] = await Promise.all([
            this.getUserCountryFromPhoneNumber(phoneParams.userPhoneNumber),
            ...allPromises,
        ]);

        const userAssetsInfo = userAssetsInfoEntries.flat();

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
        assetsInfo: AssetBalance[],
        fiatConfig?: {
            conversionRate: number;
            localCurrencySymbol: string;
            countryCode: string;
        }
    ) {
        // The fiat conversionRate assumes all the assets are stable coins so, in the event of non-stable-coin assets, it has to be refactored.
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;

        const userBalancesMessage = assetsInfo.map((assetInfo) => {
            return generateAssetBalanceMessageV2(assetInfo, fiatConfig);
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
