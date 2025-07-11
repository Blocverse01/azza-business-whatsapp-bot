import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import ManualOfframpSettlementService, {
    ManualOfframpSettlement,
} from '@/app/FiatRamp/alternatives/ManualOfframpSettlementService';
import {
    BELL_OFFRAMP_PAYMENT_PROCESSOR_ID,
    HONEYCOIN_OFFRAMP_PAYMENT_PROCESSOR_ID,
    MANUAL_OFFRAMP_PAYMENT_PROCESSOR_ID,
    ProcessorId,
    SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID,
} from '@/app/FiatRamp/config';
import {
    Beneficiary,
    CreateBeneficiaryParams,
    OnrampTransactionPayload,
    resolveBankAccountSchema,
    SendOfframpRequestPayload,
    sendOfframpRequestPayloadSchema,
    SendOnrampTransactionResponse,
    supportedPaymentNetworkType,
    TransactionFees,
    transactionStatusSchema,
} from '@/app/FiatRamp/fiatRampSchema';
import FiatRampsRpcService from '@/app/FiatRamp/grpcService/FiatRampsRpcService';
import {
    BELL_WITHDRAWAL_LIMIT,
    NGN_BANK_BALANCE_FOR_TRANSACTION_FEE,
    PALM_PAY_BANK_SEERBIT_ID,
    SAFEHAVEN_WITHDRAWAL_LIMIT,
} from '@/app/NigeriaBanks/SafeHaven/constants';
import env from '@/constants/env';
import { HUNDRED } from '@/constants/numbers';
import { BAD_REQUEST } from '@/constants/status-codes';
import { HttpException } from '@/resources/exceptions/HttpException';
import type { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import { getNetworkTag } from '@/runtime/platform-wallets';
import { CountryCode } from 'libphonenumber-js';
import * as math from 'mathjs';
import crypto from 'node:crypto';
import slugify from 'slugify';
import { mobileMoneyOffRampProvidersForKenya } from '@/app/HoneyCoin/whiteListedMobileMoneyChannel';

import {
    YellowCardOfframpEvent,
    YellowCardOfframpEvents,
    YellowCardOnRampEvent,
    YellowCardOnRampEvents,
    YellowCardWebhookPayload,
} from './types';
import SafeHavenService from '../NigeriaBanks/SafeHaven/SafeHavenService';
import NigeriaBanksService from '../NigeriaBanks/NigeriaBanksService';
import BellService from '../NigeriaBanks/BellMFB/BellService';
import { recommendedOffRampChannelForKenya } from '../HoneyCoin/whiteListedMobileMoneyChannel';
import HoneyCoinService from '../HoneyCoin/HoneyCoinService';
import { UserIdentityInfo } from '../User/userSchema';
import userServiceV2 from '@/runtime/user';
import { VASServiceType } from '../NigeriaBanks/SafeHaven/SafeHaveSchema';
import { dbClient } from '@/db/dbClient';
import { CompositeRateService } from '../rates/RateService';
import { isNonEmptyString } from '@/resources/utils/transformers';
import { normalizeTxHash } from './utils';

class FiatRampService {
    public static readonly SERVICE_ENABLED = true;
    private static readonly rateService = new CompositeRateService();

    public static async getSupportedCurrencies() {
        return await FiatRampsRpcService.getSupportedCountries();
    }

    public static async getTransactionFee(countryCode: CountryCode, route: 'onramp' | 'offramp') {
        return await FiatRampsRpcService.getTransactionFee(countryCode, route);
    }

    public static async getAllRates() {
        return await this.rateService.getRates();
    }

    public static async getMultipleRates(targetCurrencies: Array<string> = []) {
        return await this.rateService.getRates(targetCurrencies);
    }

    public static async getCurrencyRates(currencySymbol: string) {
        return await this.rateService.getCurrencyRates(currencySymbol);
    }

    public static async getBuyRate(currencySymbol: string) {
        return (await this.getCurrencyRates(currencySymbol)).buy;
    }

    public static async getSellRate(currencySymbol: string) {
        return (await this.getCurrencyRates(currencySymbol)).sell;
    }

    public static async getQuotes(
        currencySymbol: string,
        countryCode: CountryCode,
        route: 'onramp' | 'offramp'
    ) {
        return await FiatRampsRpcService.getQuotes(currencySymbol, countryCode, route);
    }

    public static async getPaymentMethods(countryCode: CountryCode, route: 'onramp' | 'offramp') {
        const args = [countryCode, route] as const;

        const isKenya = countryCode === 'KE';
        const isOfframp = route === 'offramp';

        const { paymentChannels, countryFiatLimits } = await FiatRampsRpcService.getPaymentMethods(
            ...args
        );

        //check if HoneyCoin mobile money payout is enabled for kenya
        const honeyCoinKESMobileMoneyPayoutIsEnabled = await FeatureFlagService.isFeatureEnabled(
            FeatureFlagKey.HONEYCOIN_OFFRAMP
        );

        if (honeyCoinKESMobileMoneyPayoutIsEnabled && isKenya && isOfframp) {
            const { paymentChannels: recommendedChannels, countryFiatLimits } =
                recommendedOffRampChannelForKenya;

            const updatedChannels = [
                ...paymentChannels.filter(
                    (c) => !recommendedChannels.some((rc) => rc.channelName === c.channelName)
                ),
                ...recommendedChannels,
            ];

            return {
                paymentChannels: updatedChannels,
                countryFiatLimits,
            };
        }

        return { paymentChannels, countryFiatLimits };
    }

    public static formatPaymentMethodName(channelName: string, route: 'onramp' | 'offramp') {
        if (route === 'onramp') {
            return channelName === 'bank' ? 'Bank Transfer' : 'Mobile Money';
        }
        return channelName === 'bank' ? 'Bank Account' : 'Mobile Money Account';
    }

    public static async getSupportedMobileProviders(countryCode: CountryCode, channelId: string) {
        if (countryCode === 'KE') {
            const honeyCoinKESMobileMoneyPayoutIsEnabled =
                await FeatureFlagService.isFeatureEnabled(FeatureFlagKey.HONEYCOIN_OFFRAMP);
            if (honeyCoinKESMobileMoneyPayoutIsEnabled) {
                return mobileMoneyOffRampProvidersForKenya;
            }
        }
        return await FiatRampsRpcService.getPaymentNetworks(countryCode, channelId);
    }

    public static async postOnRampTransaction(
        transactionPayload: OnrampTransactionPayload
    ): Promise<SendOnrampTransactionResponse> {
        return await FiatRampsRpcService.createPlatformOnrampRequest(transactionPayload);
    }

    public static async getSupportedBanks(countryCode: CountryCode, channelId: string) {
        const networks = await FiatRampsRpcService.getPaymentNetworks(countryCode, channelId);

        if (countryCode === 'NG') {
            const safeHavenBank = await SafeHavenService.getSupportedBanks();

            const commonBanks = safeHavenBank.reduce<supportedPaymentNetworkType[]>(
                (accumulator, safeHavenBank) => {
                    const matchingYellowCardBank = networks.find((bank) => {
                        return (
                            safeHavenBank.bankCode === bank.seerbitId ||
                            (env.WEB3_ENVIRONMENT === 'testnet' &&
                                safeHavenBank.slug ===
                                slugify(bank.name, { lower: true, replacement: '-' }))
                        );
                    });

                    if (matchingYellowCardBank) {
                        accumulator.push({
                            channelId: matchingYellowCardBank.channelId,
                            networkId: matchingYellowCardBank.networkId,
                            seerbitId: safeHavenBank.bankCode,
                            name: safeHavenBank.name,
                        });
                    }
                    return accumulator;
                },
                []
            );

            return commonBanks;
        }

        return networks;
    }

    public static async getBankNetwork(data: {
        networkId: string;
        countryCode: CountryCode;
        channelId: string;
    }) {
        const { networkId, countryCode, channelId } = data;

        const banks = await this.getSupportedBanks(countryCode, channelId);

        const network = banks.find((bank) => bank.networkId === networkId);

        if (!network) throw new Error(`Network not found`);

        return network;
    }

    public static async getSeerBitId(data: {
        networkId: string;
        countryCode: CountryCode;
        channelId: string;
    }) {
        const { networkId, countryCode, channelId } = data;

        const bank = await this.getBankNetwork({ networkId, countryCode, channelId });

        return {
            seerbitId: bank.seerbitId,
        };
    }

    public static async getAccountNameEntryId(data: {
        networkId: string;
        countryCode: CountryCode;
        channelId: string;
        accountNumber: string;
    }) {
        const { networkId, countryCode, channelId, accountNumber } = data;

        const bank = await this.getBankNetwork({ networkId, countryCode, channelId });

        const accountNameEnquiry = await SafeHavenService.accountNameEnquiry({
            bankCode: bank.seerbitId ?? '',
            accountNumber: accountNumber,
        });

        return {
            seerbitId: accountNameEnquiry.bankCode,
            nameEnquiryReference: accountNameEnquiry.sessionId,
        };
    }

    public static async createBeneficiary(
        ownerId: string,
        countryCode: CountryCode,
        accountType: 'bank' | 'phone',
        params: CreateBeneficiaryParams
    ) {
        return await FiatRampsRpcService.addBeneficiary(ownerId, countryCode, accountType, params);
    }

    public static async getBeneficiaries(
        ownerId: string,
        countryCode: CountryCode,
        accountType: 'bank' | 'phone' | undefined = undefined
    ) {
        return FiatRampsRpcService.getBeneficiaries(ownerId, countryCode, accountType);
    }

    public static async getBeneficiary(beneficiaryId: string) {
        return await FiatRampsRpcService.getBeneficiary(beneficiaryId);
    }

    public static async tryManualPayout(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload
    ) {
        return await FiatRampService.passOfframpTransactionToManualProcess(beneficiary, params);
    }

    public static async trySafeHavenPayout(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload,
        narration?: string
    ) {
        const balance = await SafeHavenService.getSafeHavenAccountBalance();
        const transferableBalance = balance - NGN_BANK_BALANCE_FOR_TRANSACTION_FEE;

        const withinLimits =
            transferableBalance >= params.localAmount &&
            params.localAmount <= SAFEHAVEN_WITHDRAWAL_LIMIT;

        if (withinLimits) {
            // SafeHaven is available, sufficiently funded, and within withdrawal limits — use it.
            return await FiatRampService.passOfframpTransactionToSafeHaven(
                beneficiary,
                params,
                narration
            );
        }

        return null;
    }

    public static async tryBellPayout(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload,
        senderName: string
    ) {
        const bellBalance = await BellService.getBellAccountBalance();
        const transferableBalance = bellBalance - NGN_BANK_BALANCE_FOR_TRANSACTION_FEE;

        const withinLimits =
            transferableBalance >= params.localAmount &&
            params.localAmount <= BELL_WITHDRAWAL_LIMIT;

        if (withinLimits) {
            // Bell is available, sufficiently funded, and within withdrawal limits — use it.
            return await FiatRampService.passOfframpTransactionToBell(
                beneficiary,
                params,
                senderName
            );
        }

        return null;
    }

    public static async postNgnVasTransaction(params: SendOfframpRequestPayload) {
        const [ngnVasSettlement, user] = await Promise.all([
            SafeHavenService.getVasPaymentSettlementById(params.ngnVasSettlementId!),
            userServiceV2.getWhatsappUserIdentityInfo(params.userId),
        ]);

        if (!user) throw new Error('User not found');

        let sequenceId: string = '';

        if (ngnVasSettlement.transactionType === VASServiceType.AIRTIME) {
            const transaction = await SafeHavenService.payAirtime(
                ngnVasSettlement.id,
                user.phoneNumber,
                params.txHash,
                {
                    phoneNumber: ngnVasSettlement.recipient.recipientPhoneNumber!,
                    amount: ngnVasSettlement.localAmount!,
                    serviceCategoryId: ngnVasSettlement.recipient.serviceCategoryId!,
                }
            );

            sequenceId = transaction.sequenceId;
        } else if (ngnVasSettlement.transactionType === VASServiceType.DATA) {
            const transaction = await SafeHavenService.payDataBundle(
                ngnVasSettlement.id,
                user.phoneNumber,
                params.txHash,
                {
                    phoneNumber: ngnVasSettlement.recipient.recipientPhoneNumber!,
                    amount: ngnVasSettlement.localAmount!,
                    serviceCategoryId: ngnVasSettlement.recipient.serviceCategoryId!,
                    bundleCode: ngnVasSettlement.recipient.bundleCode!,
                }
            );

            sequenceId = transaction.sequenceId;
        } else if (ngnVasSettlement.transactionType === VASServiceType.UTILITY) {
            sequenceId = '';
        }

        return sequenceId;
    }

    public static async postOfframpTransaction(params: SendOfframpRequestPayload) {
        // ============================================================================
        // INITIALIZATION: Fetch beneficiary and feature flag statuses concurrently
        // ============================================================================
        const [
            beneficiary,
            yellowCardPayoutIsEnabled,
            NGNBankIsEnabled,
            safeHavenPayoutIsEnabled,
            bellBankIsEnabled,
            honeycoinPayoutIsEnabled,
            user,
        ] = await Promise.all([
            FiatRampService.getBeneficiary(params.beneficiaryId!),
            FeatureFlagService.isFeatureEnabled(FeatureFlagKey.YELLOWCARD_NGN_PAYOUTS),
            FeatureFlagService.isFeatureEnabled(FeatureFlagKey.NGN_BANKS_PAYOUTS),
            FeatureFlagService.isFeatureEnabled(FeatureFlagKey.SAFEHAVEN_BANK),
            FeatureFlagService.isFeatureEnabled(FeatureFlagKey.BELL_BANK),
            FeatureFlagService.isFeatureEnabled(FeatureFlagKey.HONEYCOIN_OFFRAMP),
            userServiceV2.getWhatsappUserIdentityInfo(params.userId),
        ]);

        if (!user) throw new Error('User not found');

        const senderName = this.getSenderName(user);

        // ============================================================================
        // NIGERIA (NG) PROCESSING: Complex priority-based payout system
        // ============================================================================
        if (beneficiary.country.code === 'NG') {
            // ------------------------------------------------------------------------
            // Check if this is a PalmPay bank account (requires special handling)
            // ------------------------------------------------------------------------
            const isPalmPayBank =
                ('seerbitId' in beneficiary &&
                    beneficiary.seerbitId === PALM_PAY_BANK_SEERBIT_ID) ||
                ('bankName' in beneficiary &&
                    typeof beneficiary.bankName === 'string' &&
                    beneficiary.bankName.includes('PalmPay'));

            // ------------------------------------------------------------------------
            // PRIMARY PATH: Nigerian bank payouts are enabled
            // ------------------------------------------------------------------------
            if (NGNBankIsEnabled) {
                // ....................................................................
                // PRIORITY 1: Bell Bank payout (but not for PalmPay accounts)
                // ....................................................................
                if (bellBankIsEnabled && !isPalmPayBank) {
                    const bellSequenceId = await this.tryBellPayout(
                        beneficiary,
                        params,
                        senderName
                    );

                    if (bellSequenceId) {
                        // *** SUCCESS: Bell payout succeeded ***
                        return bellSequenceId;
                    }

                    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                    // BELL FALLBACK CHAIN: Bell payout failed - try fallback options
                    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

                    // If SafeHaven is not enabled, try YellowCard or manual payout
                    if (safeHavenPayoutIsEnabled) {
                        return (
                            (await this.trySafeHavenPayout(
                                beneficiary,
                                params,
                                `From: ${senderName}`
                            )) ??
                            (yellowCardPayoutIsEnabled && !params.isAgentTransaction
                                ? await this.passOfframpTransactionToYC(user, params)
                                : await this.tryManualPayout(beneficiary, params))
                        );
                    }
                    if (yellowCardPayoutIsEnabled && !params.isAgentTransaction) {
                        return await this.passOfframpTransactionToYC(user, params);
                    }
                    return await this.tryManualPayout(beneficiary, params);
                }

                // ....................................................................
                // PRIORITY 2: SafeHaven payout (when Bell is not available or is PalmPay)
                // ....................................................................
                if (safeHavenPayoutIsEnabled) {
                    const safehavenSequenceId = await this.trySafeHavenPayout(
                        beneficiary,
                        params,
                        `From: ${senderName}`
                    );

                    if (safehavenSequenceId) {
                        // *** SUCCESS: SafeHaven payout succeeded ***
                        return safehavenSequenceId;
                    }

                    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                    // SAFEHAVEN FALLBACK CHAIN: SafeHaven payout failed - try Bell or other fallbacks
                    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

                    // Bell is not available (disabled or PalmPay) - try YellowCard or manual
                    if (!bellBankIsEnabled || isPalmPayBank) {
                        if (yellowCardPayoutIsEnabled && !params.isAgentTransaction) {
                            return await this.passOfframpTransactionToYC(user, params);
                        }
                        return await this.tryManualPayout(beneficiary, params);
                    }

                    // Try Bell as fallback, then manual payout
                    return (
                        (await this.tryBellPayout(beneficiary, params, senderName)) ??
                        (yellowCardPayoutIsEnabled && !params.isAgentTransaction
                            ? await this.passOfframpTransactionToYC(user, params)
                            : await this.tryManualPayout(beneficiary, params))
                    );
                }
            }

            // ------------------------------------------------------------------------
            // NIGERIA FALLBACK: Nigerian bank payouts are disabled - try YellowCard
            // ------------------------------------------------------------------------
            if (yellowCardPayoutIsEnabled && !params.isAgentTransaction) {
                return await FiatRampService.passOfframpTransactionToYC(user, params);
            }

            // ------------------------------------------------------------------------
            // NIGERIA FINAL FALLBACK: No automated options available - manual processing
            // ------------------------------------------------------------------------
            return await this.tryManualPayout(beneficiary, params);
        }

        // ============================================================================
        // KENYA (KE) PROCESSING: Mobile Money via HoneyCoin
        // ============================================================================
        if (
            beneficiary.country.code === 'KE' &&
            'mobileProvider' in beneficiary &&
            honeycoinPayoutIsEnabled
        ) {
            // Route Kenyan mobile money transactions through HoneyCoin
            return await FiatRampService.passMobileMoneyOfframpTransactionToHoneyCoin(
                beneficiary,
                params
            );
        }

        // ============================================================================
        // DEFAULT PATH: All other countries - use YellowCard
        // ============================================================================
        return await FiatRampService.passOfframpTransactionToYC(user, params);
    }

    public static async getTransactionStatus(sequenceId: string, route: 'onramp' | 'offramp') {
        if (route === 'offramp')
            return await FiatRampsRpcService.getOfframpTransactionStatus(sequenceId);

        return await FiatRampsRpcService.getOnrampTransactionStatus(sequenceId);
    }

    public static async getOfframpTransaction(sequenceId: string) {
        return await FiatRampsRpcService.getOfframpTransaction(sequenceId);
    }

    public static async getOnrampTransaction(sequenceId: string) {
        return await FiatRampsRpcService.getOnrampTransaction(sequenceId);
    }

    public static async getHotWalletForNetwork(network: AllSupportedBlockchains) {
        const networkTag = getNetworkTag(network);
        return await FiatRampsRpcService.getHotWalletAddress(networkTag);
    }

    public static validateWebHookData(
        signature: string,
        body: YellowCardWebhookPayload,
        secretKey: string
    ) {
        if (!signature) {
            throw new HttpException(BAD_REQUEST, 'Signature is missing from request');
        }

        const bodyString: string = JSON.stringify(body);

        const calculatedSignature: string = crypto
            .createHmac('sha256', secretKey)
            .update(bodyString)
            .digest('base64');

        if (signature === calculatedSignature) {
            return JSON.parse(bodyString) as YellowCardWebhookPayload;
        } else {
            throw new HttpException(BAD_REQUEST, 'Invalid MetaData');
        }
    }

    public static eventTypeIsValid(eventType: string, txType: 'onramp' | 'offramp') {
        if (txType === 'onramp') {
            return YellowCardOnRampEvents.includes(eventType as YellowCardOnRampEvent);
        } else {
            return YellowCardOfframpEvents.includes(eventType as YellowCardOfframpEvent);
        }
    }

    public static async updateOnrampTransactionStatus(sequenceId: string, status: string) {
        return await FiatRampsRpcService.forwardOnrampTransactionStatus(sequenceId, status);
    }

    public static async updateOfframpTransactionStatus(sequenceId: string, status: string) {
        return await FiatRampsRpcService.forwardOfframpTransactionStatus(sequenceId, status);
    }

    public static get supportedCountriesForResolvingBankAccount() {
        return ['NG'];
    }

    public static async resolveBankAccount(data: {
        networkId: string;
        accountNumber: string;
        seerbitId: string;
        countryCode: string;
    }) {
        const { networkId, accountNumber, seerbitId, countryCode } = data;

        if (countryCode === 'NG') {
            const response = await SafeHavenService.accountNameEnquiry({
                bankCode: seerbitId,
                accountNumber: accountNumber,
            });

            return resolveBankAccountSchema.parse(response);
        }

        return await FiatRampsRpcService.resolveBankAccount({
            networkId,
            accountNumber,
        });
    }

    public static calculateTransactionFeeUsd(params: {
        usdAmount: number;
        defaultFeePercentage: number;
        conditionalFeePercentageConfigs: TransactionFees['conditionalFeePercentConfigs'];
        minFeeUsd: number;
        rampType: 'onramp' | 'offramp';
    }) {
        const { usdAmount, defaultFeePercentage, conditionalFeePercentageConfigs, minFeeUsd } =
            params;

        const possibleConditionalFeeConfigs = conditionalFeePercentageConfigs.filter((config) => {
            if (config.rampType !== params.rampType) return false;

            switch (config.rule) {
                case '$gt':
                    return usdAmount > config.triggerAmount;
                case '$lt':
                    return usdAmount < config.triggerAmount;
                case '$gte':
                    return usdAmount >= config.triggerAmount;
            }
        });

        const conditionalFee = possibleConditionalFeeConfigs.find((config) => {
            return (
                Math.max(...possibleConditionalFeeConfigs.map((config) => config.triggerAmount)) ===
                config.triggerAmount
            );
        });

        const feePercentage = conditionalFee ? conditionalFee.feePercentage : defaultFeePercentage;

        const percentToDecimal = math.divide(feePercentage, HUNDRED);
        const calculatedFeeUsd = math.multiply(usdAmount, percentToDecimal);

        return {
            feeUsd: Math.max(minFeeUsd, calculatedFeeUsd),
            feePercentage,
        };
    }

    public static calculateFiatAmountToReceiveFromUsdAmount(input: {
        usdAmount: number;
        conversionRate: number;
        rampType: 'onramp' | 'offramp';
        feeConfig: {
            defaultFeePercentage: number;
            conditionalFeePercentageConfigs: TransactionFees['conditionalFeePercentConfigs'];
            minFeeUsd: number;
        };
    }) {
        const { usdAmount, conversionRate, rampType, feeConfig } = input;

        const feeData = this.calculateTransactionFeeUsd({
            usdAmount,
            ...feeConfig,
            rampType,
        });

        const usdAmountToProcess = math.subtract(usdAmount, feeData.feeUsd);
        const fiatAmountToReceive = math.multiply(usdAmountToProcess, conversionRate);

        return {
            fiatAmount: fiatAmountToReceive,
            usdAmountToProcess,
            transactionFeeUsd: feeData.feeUsd,
            totalAmountUsd: math.add(usdAmountToProcess, feeData.feeUsd),
        };
    }

    private static async _prepareOfframpSettlementData(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload,
        processorIdentifier: ProcessorId
    ): Promise<ManualOfframpSettlement> {
        const validatedParams = sendOfframpRequestPayloadSchema.parse(params);
        const localCurrencySymbol = beneficiary.country.currencySymbol;

        return {
            localCurrencySymbol,
            localAmount: validatedParams.localAmount,
            usdAmount: validatedParams.usdAmount,
            transactionHash: validatedParams.txHash,
            transactionFeeUsd: validatedParams.transactionFeeUsd,
            tokenSymbol: validatedParams.tokenName,
            blockchainNetwork: validatedParams.chainName,
            rate: validatedParams.conversionRate,
            tokenAddress: validatedParams.tokenAddress,
            ownerId: validatedParams.userId,
            fromWalletAddress: validatedParams.userWalletAddress,
            hotWalletAddress: validatedParams.hotWalletAddress,
            processorName: processorIdentifier,
            sequenceId: ManualOfframpSettlementService.generateSequenceId(
                validatedParams.txHash,
                processorIdentifier
            ),
            platformFeePercentage: validatedParams.platformFeePercentage,
            destination: {
                accountType: 'mobileNumber' in beneficiary ? 'phone' : 'bank',
                accountNumber:
                    'mobileNumber' in beneficiary
                        ? beneficiary.mobileNumber
                        : beneficiary.accountNumber,
                accountName:
                    'accountName' in beneficiary
                        ? beneficiary.accountName
                        : beneficiary.firstName + ' ' + beneficiary.lastName,
                networkName:
                    'bankName' in beneficiary ? beneficiary.bankName : beneficiary.mobileProvider,
                seerbitId: 'bankName' in beneficiary ? beneficiary.seerbitId : '',
                nameEnquiryReference:
                    'bankName' in beneficiary ? beneficiary.nameEnquiryReference : '',
                networkId: beneficiary.networkId,
                country: beneficiary.country.code,
                channelId: beneficiary.channelId,
            },
        };
    }

    private static async passOfframpTransactionToBell(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload,
        senderName: string
    ) {
        const [settlementData, offrampRequest] = await Promise.all([
            this._prepareOfframpSettlementData(
                beneficiary,
                params,
                BELL_OFFRAMP_PAYMENT_PROCESSOR_ID
            ),
            dbClient.offramp_awaiting_crypto_debit
                .filter({
                    cryptoTransactionId: normalizeTxHash(params.txHash),
                })
                .getFirst(),
        ]);

        if (!offrampRequest) {
            throw new Error('Offramp request not found');
        }

        const bellSettlementRecord =
            await NigeriaBanksService.createNGNOfframpSettlement(settlementData);

        if (!bellSettlementRecord.sequenceId) {
            throw new Error('Failed to create bell settlement record');
        }

        const { seerbitId, accountNumber, networkId, channelId, country } =
            settlementData.destination;

        const _seerbitId =
            seerbitId ??
            (
                await this.getSeerBitId({
                    networkId: networkId,
                    channelId: channelId as string,
                    countryCode: country as CountryCode,
                })
            ).seerbitId;

        await NigeriaBanksService.sendProcessingSettlementMessage({
            tokenAmountDebited: offrampRequest.tokenAmountToDebit,
            ownerId: bellSettlementRecord.ownerId,
            tokenSymbol: bellSettlementRecord.tokenSymbol,
            blockchainNetwork: bellSettlementRecord.blockchainNetwork,
            localCurrencySymbol: bellSettlementRecord.localCurrencySymbol!,
            localAmount: bellSettlementRecord.localAmount,
        });

        const transaction = await BellService.processOffRampPaymentWithBell({
            amountToSend: settlementData.localAmount,
            senderName: senderName,
            beneficiaryBankCode: _seerbitId!,
            beneficiaryAccountNumber: accountNumber,
            sequenceId: bellSettlementRecord.sequenceId,
        });

        if (!transaction) {
            throw new Error('Failed to process off-ramp settlement with bell');
        }

        const isUpdated = await bellSettlementRecord.update({
            sessionId: transaction.sessionId,
            processingStatus: transactionStatusSchema.parse('processing'),
        });

        if (!isUpdated) {
            throw new Error('Failed to update bell off-ramp settlement status');
        }

        return transaction.sequenceId;
    }

    private static async passMobileMoneyOfframpTransactionToHoneyCoin(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload
    ) {
        const settlementData = await this._prepareOfframpSettlementData(
            beneficiary,
            params,
            HONEYCOIN_OFFRAMP_PAYMENT_PROCESSOR_ID
        );

        if (settlementData.localCurrencySymbol !== 'KES') {
            throw new Error(
                `Feature not available for currency: ${settlementData.localCurrencySymbol}`
            );
        }

        const honeycoinSettlementRecord =
            await HoneyCoinService.createHoneyCoinMobileMoneyOfframpSettlement(settlementData);

        if (!honeycoinSettlementRecord.referenceId) {
            throw new Error('Failed to create honeycoin settlement record');
        }

        const { accountNumber, accountName } = settlementData.destination;

        const transaction = await HoneyCoinService.processMobileMoneyOffRampPaymentWithHoneyCoin({
            amountToSend: settlementData.localAmount,
            beneficiaryAccountNumber: accountNumber.startsWith('+')
                ? accountNumber.slice(1)
                : accountNumber,
            beneficiaryAccountName: accountName,
            sequenceId: honeycoinSettlementRecord.referenceId,
        });

        if (!transaction) {
            throw new Error('Failed to process off-ramp settlement with honeycoin');
        }

        return transaction.sequenceId;
    }

    private static async passOfframpTransactionToSafeHaven(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload,
        narration?: string
    ) {
        const [settlementData, offrampRequest] = await Promise.all([
            this._prepareOfframpSettlementData(
                beneficiary,
                params,
                SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID
            ),
            dbClient.offramp_awaiting_crypto_debit
                .filter({
                    cryptoTransactionId: normalizeTxHash(params.txHash),
                })
                .getFirst(),
        ]);

        if (!offrampRequest) {
            throw new Error('Offramp request not found');
        }

        if (settlementData.localCurrencySymbol !== 'NGN') {
            throw new Error(
                `Feature not available for currency: ${settlementData.localCurrencySymbol}`
            );
        }

        const safeHavenSettlementRecord =
            await NigeriaBanksService.createNGNOfframpSettlement(settlementData);

        if (!safeHavenSettlementRecord.sequenceId) {
            throw new Error('Failed to create safehaven settlement record');
        }

        const { networkId, country, channelId, seerbitId, nameEnquiryReference, accountNumber } =
            settlementData.destination;

        const accountNameEnquiry = isNonEmptyString(nameEnquiryReference)
            ? { seerbitId: '', nameEnquiryReference: '' }
            : await this.getAccountNameEntryId({
                networkId,
                countryCode: country as CountryCode,
                channelId: channelId!,
                accountNumber,
            });

        const finalNameEnquiryReference = isNonEmptyString(nameEnquiryReference)
            ? nameEnquiryReference
            : accountNameEnquiry.nameEnquiryReference;

        const finalSeerbitId = isNonEmptyString(seerbitId)
            ? seerbitId
            : accountNameEnquiry.seerbitId;
        
        
        await NigeriaBanksService.sendProcessingSettlementMessage({
            tokenAmountDebited: offrampRequest.tokenAmountToDebit,
            ownerId: safeHavenSettlementRecord.ownerId,
            tokenSymbol: safeHavenSettlementRecord.tokenSymbol,
            blockchainNetwork: safeHavenSettlementRecord.blockchainNetwork,
            localCurrencySymbol: safeHavenSettlementRecord.localCurrencySymbol!,
            localAmount: safeHavenSettlementRecord.localAmount,
        });


        const transaction = await SafeHavenService.processOffRampPaymentWithSaveHaven({
            nameEnquiryReference: finalNameEnquiryReference,
            amountToSend: settlementData.localAmount,
            beneficiaryBankCode: finalSeerbitId,
            beneficiaryAccountNumber: accountNumber,
            sequenceId: safeHavenSettlementRecord.sequenceId,
            narration,
        });

        if (!transaction) {
            throw new Error('Failed to process off-ramp settlement with safehaven');
        }

        const isUpdated = await safeHavenSettlementRecord.update({
            sessionId: transaction.sessionId,
            processingStatus: transactionStatusSchema.parse('processing'),
        });

        if (!isUpdated) {
            throw new Error('Failed to update safehaven off-ramp settlement status');
        }

        return transaction.sequenceId;
    }

    private static getSenderName(sender: UserIdentityInfo) {
        let senderName = '';
        if (sender.firstName) {
            senderName += sender.firstName;
        }
        if (sender.lastName) {
            senderName += ` ${sender.lastName}`;
        }

        return senderName;
    }

    private static async passOfframpTransactionToManualProcess(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload
    ) {
        const settlementData = await this._prepareOfframpSettlementData(
            beneficiary,
            params,
            MANUAL_OFFRAMP_PAYMENT_PROCESSOR_ID
        );

        if (settlementData.localCurrencySymbol !== 'NGN') {
            throw new Error(
                `Feature not available for currency: ${settlementData.localCurrencySymbol}`
            );
        }

        const manualSettlementRecord =
            await ManualOfframpSettlementService.createManualOfframpSettlement(settlementData);

        if (!manualSettlementRecord.sequenceId) {
            throw new Error('Failed to create manual settlement record');
        }

        await ManualOfframpSettlementService.sendManualSettleMessages(
            env.WA_PHONE_NUMBER_ID,
            settlementData
        );

        return manualSettlementRecord.sequenceId;
    }

    private static async passOfframpTransactionToYC(
        sender: UserIdentityInfo,
        params: SendOfframpRequestPayload
    ) {
        return await FiatRampsRpcService.createBeneficiaryOfframpRequest(sender, params);
    }
}

export default FiatRampService;
