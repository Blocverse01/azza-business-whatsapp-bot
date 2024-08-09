import {
    ASSET_ACTION_REGEX_PATTERN,
    AssetInteractiveButtonIds,
    assetInteractiveButtonsIds,
    BaseInteractiveButtonIds,
    ExploreAssetActions,
    FlowNfmReplyResponse,
    InteractiveButtonReplyTypes,
    InteractiveListReplyTypes,
    InteractiveNfmReplyActions,
    manageAssetActions,
    MORE_CURRENCIES_COMMAND_REGEX_PATTERN,
    PhoneNumberParams,
    TriggerOfframpFromAddBeneficiaryActionParams,
    //WhatsAppInteractiveButton,
    WhatsAppInteractiveMessage,
    WhatsAppMessageType,
    WhatsAppTextMessage,
} from './WhatsAppBotType';
import axios from 'axios';
import env from '@/constants/env';
import UserService from '@/app/User/UserService';
import logger from '@/Resources/logger';
import { UserAssetItem } from '@/app/User/userSchema';
import {
    BankBeneficiary,
    MobileMoneyBeneficiary,
    UsersBeneficiaries,
} from '@/app/FiatRamp/fiatRampSchema';
import { logServiceError } from '@/Resources/requestHelpers/handleRequestError';
import FiatRampService from '@/app/FiatRamp/FiatRampService';
import { TokenNames } from '@/Resources/web3/tokens';
import { getAssetConfigOrThrow } from '@/config/whatsAppBot';
import {
    SELL_BENEFICIARY_AMOUNT_PATTERN,
    SELL_ASSET_TO_BENEFICIARY_REGEX_PATTERN,
    SELL_ASSET_DESTINATION_CHOICE_REGEX,
    TRADE_ASSET_REGEX,
} from '@/constants/regex';
import SumSubService from '@/app/SumSub/SumSubService';
import {
    convertBase64ToAsciiString,
    decryptRequest,
    encryptResponse,
} from '@/Resources/utils/encryption';
import WhatsAppBotOffRampFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotOffRampFlowService';
import MessageGenerators from '@/app/WhatsAppBot/MessageGenerators';
import { CountryCode } from 'libphonenumber-js';
import WhatsAppBotAddBeneficiaryFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotAddBeneficiaryFlowService';
import { Message } from '@/app/WhatsAppBot/WhatsAppBotController';
import { HttpException } from '@/Resources/exceptions/HttpException';
import { INTERNAL_SERVER_ERROR } from '@/constants/status-codes';
import WhatsAppBotTransferToWalletFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotTransferToWalletFlowService';
import WhatsAppBotOnRampFlowService from '@/app/WhatsAppBot/WhatsAppFlows/WhatsAppBotOnRampFlowService';
import { getCountryFlagEmoji, getUserCountryCodeFromPhoneNumber } from '@/Resources/utils/currency';

class WhatsAppBotService {
    private static WA_BUSINESS_PHONE_NUMBER = env.WA_PHONE_NUMBER_ID;

    private static getRequestConfig() {
        return {
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                Authorization: `Bearer ${env.CLOUD_API_ACCESS_TOKEN}`,
            },
        };
    }

    public static async sendWhatsappMessage(businessPhoneNumberId: string, data: object) {
        const endpoint = `${businessPhoneNumberId}/messages`;

        try {
            const requestOptions = this.getRequestConfig();
            const response = await axios.post(
                `${env.CLOUD_API_URL}/${endpoint}`,
                data,
                requestOptions
            );

            await logger.info('Message sent successfully', {
                responseData: response.data,
            });
        } catch (error) {
            await logServiceError(error, 'Error sending message');
            throw error;
        }
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
                    title: `${asset.name} (${asset.network})`,
                    description: `${asset.name} on ${asset.network}`,
                })),
                bodyText: text,
                headerText: 'Manage Your Assets',
                actionButtonText: 'Manage Assets',
            });

        // TODO: Review new implementation with stakeholders and remove dead code.

        // const walletAssetsButton: WhatsAppInteractiveButton[] = walletAssets
        //     .map((asset) => ({
        //         type: 'reply' as const,
        //         reply: {
        //             id: asset.listItemId,
        //             title: `${asset.name} (${asset.network.toUpperCase()})`,
        //         },
        //     }))
        //     .slice(0, 2);

        // const interactiveMessage: WhatsAppInteractiveMessage = {
        //     type: 'interactive',
        //     interactive: {
        //         type: 'button',
        //         body: {
        //             text: text,
        //         },
        //         action: {
        //             buttons: walletAssetsButton,
        //         },
        //     },
        //     messaging_product: 'whatsapp',
        //     recipient_type: 'individual',
        //     to: recipient,
        // };
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
        assetId: string
    ) {
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
                                    description = `Mobile Number: ${mobileMoneyBeneficiaryCast.firstName}`;
                                } else {
                                    const bankBeneficiaryCast = beneficiary as BankBeneficiary;
                                    title = `${bankBeneficiaryCast.accountName}`;
                                    description = `Bank Name: ${bankBeneficiaryCast.bankName}\nAccount Number: ${bankBeneficiaryCast.accountNumber}`;
                                }
                                return {
                                    id: `sell:${assetId}|beneficiaryId:${beneficiary.id}`,
                                    title: title,
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
        userAssetInfo: {
            usdDisplayBalance: string;
            tokenBalance: string;
            walletAddress: string;
            listItemId: string;
            assetName: string;
            assetNetwork: string;
        }
    ) {
        const { usdDisplayBalance, listItemId, tokenBalance, assetName, assetNetwork } =
            userAssetInfo;

        const interactiveListMessage = MessageGenerators.generateInteractiveListMessage({
            recipient,
            listItems: manageAssetActions.map((assetAction) => ({
                id: `${assetAction.action}:${listItemId}`,
                title: assetAction.text,
                description: assetAction.description,
            })),
            bodyText: `\n*Asset Balance* 💰: ${tokenBalance}\n\n*Asset Balance(USD)* 💰: ${usdDisplayBalance}`,
            headerText: `${assetName} (${assetNetwork})`,
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

            logger.info('Message marked as read successfully:', response.data); // Handle successful response (optional)
        } catch (error) {
            await logServiceError(error, 'Error marking message as read:');
        }
    }

    public static async beginAddBeneficiaryFlowMessage(
        params: PhoneNumberParams & {
            assetId: string;
            countryCode: CountryCode;
        }
    ) {
        const { assetId, countryCode, userPhoneNumber, businessPhoneNumberId } = params;

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

    // TODO: Remove dead code
    public static async isMessageProcessed(messageId: string) {
        try {
            const data = await UserService.getUserByMessageId(messageId);
            return !!data;
        } catch (error) {
            await logServiceError(error, 'Error checking processed messages:');
        }
    }

    // Function to mark message as processed
    // TODO: Remove dead code
    public static async markMessageProcessed(messageId: string): Promise<void> {
        try {
            await UserService.markMessageProcessed(messageId);
        } catch (error) {
            await logServiceError(error, 'Error marking message as processed:');
        }
    }

    public static async ratesCommandHandler(
        userPhoneNumber: string,
        businessPhoneNumberId: string
    ) {
        const rates = await FiatRampService.getAllRates();

        const userCountryCode = getUserCountryCodeFromPhoneNumber(userPhoneNumber);
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
                body: `_*Conversion Rates*_\n\n${rates.map((rate) => `${getCountryFlagEmoji(rate.locale)} ${rate.code}/USD\nBuy: ${rate.buy}\nSell: ${rate.sell}\n-------------------`).join('\n')}`,
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
        const asset = await UserService.getUserAssetWalletOrThrow(userPhoneNumber, listItemId);

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
    }

    /**
     * @deprecated
     */
    public static async processTransactionInDemoMode(
        userPhoneNumber: string,
        businessPhoneNumberId: string,
        params: { assetId: string; beneficiaryId: string; usdAmount: string }
    ) {
        const asset = await UserService.getUserAssetWalletOrThrow(userPhoneNumber, params.assetId);

        // Can only offramp USDC in demo mode
        if (asset.name !== TokenNames.USDC) {
            return;
        }

        const quote = await FiatRampService.getQuotes('NGN', 'NG', 'offramp');

        const numericUsdAmount = parseFloat(params.usdAmount);
        const fiatAmountToReceive = (quote.rate * numericUsdAmount).toFixed(2);

        const cryptoAmountToDebit = (numericUsdAmount + numericUsdAmount * quote.fee).toFixed(2);

        const { transactionId, hotWalletAddress } = await UserService.sendUserAssetForOfframp(
            asset,
            cryptoAmountToDebit
        );

        const messagePayload: WhatsAppTextMessage = {
            type: WhatsAppMessageType.TEXT,
            text: {
                body: `🚀Processing Bank Account Withdrawal\n\nAsset:${asset.name}\nAmount: ${cryptoAmountToDebit} USDC\nEquivalent: ${fiatAmountToReceive} NGN\nTransaction ID: ${transactionId}`,
                preview_url: false,
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: userPhoneNumber,
        };

        await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, messagePayload);

        await UserService.processOfframpTransactionInDemoMode(transactionId, {
            beneficiaryId: params.beneficiaryId,
            usdAmount: cryptoAmountToDebit,
            localAmount: fiatAmountToReceive,
            tokenAddress: asset.tokenAddress,
            hotWalletAddress: hotWalletAddress,
            chainName: asset.network.toUpperCase(),
            tokenName: 'USDC',
            userWalletAddress: asset.walletAddress,
        });
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

        if (interactiveButtonId.match(SELL_BENEFICIARY_AMOUNT_PATTERN)) {
            return 'demo-withdraw-amount-to-beneficiary';
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
                ? flowResponseParams.flow_id === WhatsAppBotAddBeneficiaryFlowService.FLOW_ID
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

        const messagePayload: WhatsAppTextMessage = {
            type: WhatsAppMessageType.TEXT,
            text: {
                body: `Please click on the link to verify your identity: ${kycUrl}`,
                preview_url: false,
            },
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: userPhoneNumber,
        };

        await WhatsAppBotService.sendWhatsappMessage(businessPhoneNumberId, messagePayload);
    }

    public static async sendSelectSupportedCurrenciesMessage(
        phoneParams: PhoneNumberParams,
        assetActionId: Extract<ExploreAssetActions, 'buy' | 'sell'>,
        purchaseAssetId: AssetInteractiveButtonIds,
        _sliceFrom = 0,
        _sliceTo = 9
    ) {
        const { userPhoneNumber, businessPhoneNumberId } = phoneParams;

        const userCountryCode = getUserCountryCodeFromPhoneNumber(userPhoneNumber);
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

        const interactiveMessage: WhatsAppInteractiveMessage = {
            type: 'interactive',
            interactive: {
                type: 'list',
                body: {
                    text: "Click on 'Currencies' to select your local currency.",
                },
                header: {
                    type: 'text',
                    text: `Select Your Local Currency - Page ${page}`,
                },
                action: {
                    button: 'Currencies',
                    sections: [
                        {
                            rows: [
                                ...countriesToDisplay.map((country) => {
                                    return {
                                        id: `${assetActionId}:${purchaseAssetId}|currency:${country.currencySymbol}|countryCode:${country.code}`,
                                        title: `${getCountryFlagEmoji(country.code)} ${country.country}`,
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
        assetId: AssetInteractiveButtonIds
    ) {
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
        assetId: AssetInteractiveButtonIds
    ) {
        if (SumSubService.SERVICE_IS_ACTIVE) {
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
}

export default WhatsAppBotService;
