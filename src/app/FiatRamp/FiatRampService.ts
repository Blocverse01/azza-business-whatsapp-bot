import { FeatureFlagKey } from '@/app/FeatureFlag/feature-flag-schema';
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
        const [beneficiary, ngnPayoutIsEnabled] = await Promise.all([
            FiatRampService.getBeneficiary(params.beneficiaryId),
            FeatureFlagService.isFeatureEnabled(FeatureFlagKey.YELLOWCARD_NGN_PAYOUTS),
        ]);

        if (beneficiary.country.code === 'NG' && !ngnPayoutIsEnabled) {
            return await FiatRampService.passOfframpTransactionToManualProcess(beneficiary, params);
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

    public static async resolveBankAccount(networkId: string, accountNumber: string) {
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

    public static async passOfframpTransactionToManualProcess(
        beneficiary: Beneficiary,
        params: SendOfframpRequestPayload
    ) {
        const validatedParams = sendOfframpRequestPayloadSchema.parse(params);
        const localCurrencySymbol = beneficiary.country.currencySymbol;

        if (localCurrencySymbol !== 'NGN') {
            throw new Error(`Feature not available for currency: ${localCurrencySymbol}`);
        }

        const offrampTransaction: ManualOfframpSettlement = {
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
            sequenceId: ManualOfframpSettlementService.generateSequenceId(validatedParams.txHash),
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
                networkId: beneficiary.networkId,
                country: beneficiary.country.code,
            },
        };

        const manualSettlementRecord =
            await ManualOfframpSettlementService.createManualOfframpSettlement(offrampTransaction);

        if (!manualSettlementRecord.sequenceId) {
            throw new Error('Failed to create manual settlement record');
        }

        await ManualOfframpSettlementService.sendManualSettleMessages(
            env.WA_PHONE_NUMBER_ID,
            offrampTransaction
        );

        return manualSettlementRecord.sequenceId;
    }
}

export default FiatRampService;
