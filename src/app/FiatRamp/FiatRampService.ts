import { FeatureFlagKey, SAFEHAVEN_BALANCE_FOR_TRANSACTION_FEE, SAFEHAVEN_WITHDRAWAL_LIMIT } from '@/app/FeatureFlag/feature-flag-schema';
import FeatureFlagService from '@/app/FeatureFlag/FeatureFlagService';
import ManualOfframpSettlementService, {
    ManualOfframpSettlement,
} from '@/app/FiatRamp/alternatives/ManualOfframpSettlementService';
import {
    Beneficiary,
    CreateBeneficiaryParams,
    OnrampTransactionPayload,
    SendOfframpRequestPayload,
    sendOfframpRequestPayloadSchema,
    SendOnrampTransactionResponse,
    TransactionFees,
} from '@/app/FiatRamp/fiatRampSchema';
import FiatRampsRpcService from '@/app/FiatRamp/grpcService/FiatRampsRpcService';
import env from '@/constants/env';
import { HUNDRED } from '@/constants/numbers';
import { BAD_REQUEST } from '@/constants/status-codes';
import { HttpException } from '@/resources/exceptions/HttpException';
import type { AllSupportedBlockchains } from '@/resources/web3/core/blockchains';
import { getNetworkTag } from '@/runtime/platform-wallets';
import { CountryCode } from 'libphonenumber-js';
import * as math from 'mathjs';
import crypto from 'node:crypto';
import {
    YellowCardOfframpEvent,
    YellowCardOfframpEvents,
    YellowCardOnRampEvent,
    YellowCardOnRampEvents,
    YellowCardWebhookPayload,
} from './types';
import SafeHavenService from '../SafeHaven/SafeHavenService';


class FiatRampService {
    public static readonly SERVICE_ENABLED = true;

    public static async getSupportedCurrencies() {
        return await FiatRampsRpcService.getSupportedCountries();
    }

    public static async getTransactionFee(countryCode: CountryCode, route: 'onramp' | 'offramp') {
        return await FiatRampsRpcService.getTransactionFee(countryCode, route);
    }

    public static async getAllRates() {
        return await FiatRampsRpcService.getRates();
    }

    public static async getMultipleRates(targetCurrencies: Array<string> = []) {
        return await FiatRampsRpcService.getRates(targetCurrencies);
    }

    public static async getCurrencyRates(currencySymbol: string) {
        return await FiatRampsRpcService.getCurrencyRates(currencySymbol);
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

        return await FiatRampsRpcService.getPaymentMethods(...args);
    }

    public static formatPaymentMethodName(channelName: string, route: 'onramp' | 'offramp') {
        if (route === 'onramp') {
            return channelName === 'bank' ? 'Bank Transfer' : 'Mobile Money';
        }
        return channelName === 'bank' ? 'Bank Account' : 'Mobile Money Account';
    }

    public static async getSupportedMobileProviders(countryCode: CountryCode, channelId: string) {
        return await FiatRampsRpcService.getPaymentNetworks(countryCode, channelId);
    }

    public static async postOnRampTransaction(
        transactionPayload: OnrampTransactionPayload
    ): Promise<SendOnrampTransactionResponse> {
        return await FiatRampsRpcService.createPlatformOnrampRequest(transactionPayload);
    }

    public static async getSupportedBanks(countryCode: CountryCode, channelId: string) {
        return await FiatRampsRpcService.getPaymentNetworks(countryCode, channelId);
    }

    public static async getAccountNameEntryId(data:
        {
            networkId: string,
            countryCode: CountryCode,
            channelId: string,
            accountNumber: string
        }) {

        const { networkId, countryCode, channelId, accountNumber } = data;

        const bank = await FiatRampsRpcService.getNetwork({ networkId, countryCode, channelId })

        const accountNameEnquiry = await SafeHavenService.accountNameEnquiry({
            bankCode: bank.seerbitId ?? '',
            accountNumber: accountNumber
        })

        return {
            seerbitId: accountNameEnquiry.bankCode,
            nameEnquiryReference: accountNameEnquiry.sessionId
        }

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

    public static async postOfframpTransaction(params: SendOfframpRequestPayload) {

        const [beneficiary, yellowCardPayoutIsEnabled, saveHavenPayoutIsEnabled] = await Promise.all([
            FiatRampService.getBeneficiary(params.beneficiaryId),
            FeatureFlagService.isFeatureEnabled(FeatureFlagKey.YELLOWCARD_NGN_PAYOUTS),
            FeatureFlagService.isFeatureEnabled(FeatureFlagKey.SAFEHAVEN_NGN_PAYOUTS)
        ]);

        if (beneficiary.country.code === 'NG') {

            if (saveHavenPayoutIsEnabled) {

                const balance = await SafeHavenService.getSafeHavenAccountBalance();

                if ((balance + SAFEHAVEN_BALANCE_FOR_TRANSACTION_FEE) < params.localAmount) {
                    return await FiatRampService.passOfframpTransactionToManualProcess(beneficiary, params);
                }

                if ((balance + SAFEHAVEN_BALANCE_FOR_TRANSACTION_FEE) > params.localAmount
                    && params.localAmount > SAFEHAVEN_WITHDRAWAL_LIMIT
                ) {
                    return await FiatRampService.passOfframpTransactionToManualProcess(beneficiary, params);
                }

                return await FiatRampService.passOfframpTransactionToSafeHaven(beneficiary, params);
            }

            if (!yellowCardPayoutIsEnabled) {
                return await FiatRampService.passOfframpTransactionToManualProcess(beneficiary, params);
            }
        }

        return await FiatRampsRpcService.createBeneficiaryOfframpRequest(params);
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

    public static async resolveBankAccount(
        data: {
            networkId: string,
            accountNumber: string,
            seerbitId: string,
            countryCode: string
        }) {

        const { networkId, accountNumber, seerbitId, countryCode } = data;

        return await FiatRampsRpcService.resolveBankAccount({
            networkId,
            accountNumber,
            seerbitId,
            countryCode
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
        params: SendOfframpRequestPayload
    ): Promise<ManualOfframpSettlement> {

        const validatedParams = sendOfframpRequestPayloadSchema.parse(params);
        const localCurrencySymbol = beneficiary.country.currencySymbol;

        if (localCurrencySymbol !== 'NGN') {
            throw new Error(`Feature not available for currency: ${localCurrencySymbol}`);
        }

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
            sequenceId: ManualOfframpSettlementService.generateSequenceId(validatedParams.txHash, 'safehaven'),
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
                nameEnquiryReference: 'bankName' in beneficiary ? beneficiary.nameEnquiryReference : '',
                networkId: beneficiary.networkId,
                country: beneficiary.country.code,
                channelId: beneficiary.channelId
            },
        };
    }


    public static async passOfframpTransactionToSafeHaven(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload
    ) {

        const settlementData = await this._prepareOfframpSettlementData(beneficiary, params);

        const safeHavenSettlementRecord =
            await SafeHavenService.createSafeHavenOfframpSettlement(settlementData);

        if (!safeHavenSettlementRecord.sequenceId) {
            throw new Error('Failed to create safehaven settlement record');
        }

        const { networkId,
            country,
            channelId,
            seerbitId,
            nameEnquiryReference,
            accountNumber } = settlementData.destination

        let accountNameEnquiry: { seerbitId: string, nameEnquiryReference: string } = {
            seerbitId: '',
            nameEnquiryReference: '',
        };

        if (!nameEnquiryReference) {
            accountNameEnquiry = await this.getAccountNameEntryId({
                networkId: networkId,
                countryCode: country as CountryCode,
                channelId: channelId!,
                accountNumber: accountNumber
            });
        };

        await SafeHavenService.sendSafeHavenProcessingSettlementMessage({
            usdAmount: safeHavenSettlementRecord!.usdAmount!,
            transactionFeeUsd: safeHavenSettlementRecord.transactionFeeUsd!,
            ownerId: safeHavenSettlementRecord.ownerId!,
            tokenSymbol: safeHavenSettlementRecord.tokenSymbol!,
            blockchainNetwork: safeHavenSettlementRecord.blockchainNetwork!,
            localCurrencySymbol: safeHavenSettlementRecord.localCurrencySymbol!,
            localAmount: safeHavenSettlementRecord.localAmount!
        })

        const transaction = await SafeHavenService.processOffRampPaymentWithSaveHaven({
            nameEnquiryReference: (nameEnquiryReference)
                ? nameEnquiryReference : accountNameEnquiry.nameEnquiryReference,
            amountToSend: settlementData.localAmount,
            beneficiaryBankCode: (seerbitId)
                ? seerbitId : accountNameEnquiry.seerbitId,
            beneficiaryAccountNumber: accountNumber,
            sequenceId: safeHavenSettlementRecord.sequenceId
        });

        if (!transaction) {
            throw new Error('Failed to process off-ramp settlement with safehaven');
        }

        const isUpdated = await safeHavenSettlementRecord.update({
            sessionId: transaction.sessionId
        })

        if (!isUpdated) {
            throw new Error('Failed to update safehaven off-ramp settlement status');
        }

        return transaction.sequenceId;
    }

    public static async passOfframpTransactionToManualProcess(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload
    ) {

        const settlementData = await this._prepareOfframpSettlementData(beneficiary, params);

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
}

export default FiatRampService;
