import {
    BankBeneficiary,
    CreateBeneficiaryParams,
    MobileMoneyBeneficiary,
    OfframpTransactionRecordSchema,
    OnrampTransactionPayload,
    onrampTransactionRecordSchema,
    paymentMethodsResponseDataSchema,
    quoteSchema,
    ratesSchema,
    resolveBankAccountSchema,
    SendOfframpRequestPayload,
    sendOfframpRequestPayloadSchema,
    sendOnrampTransactionResponseSchema,
    supportedCountry,
    supportedPaymentNetworkSchema,
    supportedPaymentNetworkType,
} from '@/app/FiatRamp/fiatRampSchema';
import redis from '@/cache/redis';
import { HUNDRED } from '@/constants/numbers';
import { FALLBACK_USE_AZZA_ADDRESS } from '@/constants/strings';
import { fiatramps } from '@/proto/fiatramps/v1/service';
import logger from '@/resources/logger';
import { defaultAmountFixer } from '@/resources/utils/currency';
import { transformKeysToCamelCase } from '@/resources/utils/transformers';
import { PlatformAddressIdNetworkTag } from '@/runtime/platform-wallets';
import userServiceV2 from '@/runtime/user';
import { CountryCode } from 'libphonenumber-js';
import { z } from 'zod';
import {
    addBeneficiary,
    createBeneficiaryPaymentRequest,
    createPlatformCollection,
    getBeneficiaries,
    getBeneficiary,
    getCollectionRequestTransaction,
    getHotWalletAddress,
    getPaymentMethods,
    getPaymentNetworks,
    getPaymentRequestTransaction,
    getQuotes,
    getRates,
    getSupportedCountries,
    getTransactionFees,
    resolveBankAccount,
    updateCollectionTransactionStatus,
    updatePaymentTransactionStatus,
} from './rpcMethods';
import AddBeneficiaryRequest = fiatramps.v1.AddBeneficiaryRequest;
import CollectionSource = fiatramps.v1.CollectionSource;
import CreateBeneficiaryPaymentRequestInput = fiatramps.v1.CreateBeneficiaryPaymentRequestInput;
import CreatePlatformCollectionRequestInput = fiatramps.v1.CreatePlatformCollectionRequestInput;
import GetBeneficiariesRequest = fiatramps.v1.GetBeneficiariesRequest;
import GetBeneficiaryRequest = fiatramps.v1.GetBeneficiaryRequest;
import GetCollectionRequestTransactionRequest = fiatramps.v1.GetCollectionRequestTransactionRequest;
import GetHotWalletAddressRequest = fiatramps.v1.GetHotWalletAddressRequest;
import GetPaymentMethodsRequest = fiatramps.v1.GetPaymentMethodsRequest;
import GetPaymentNetworksRequest = fiatramps.v1.GetPaymentNetworksRequest;
import GetPaymentRequestTransactionRequest = fiatramps.v1.GetPaymentRequestTransactionRequest;
import GetQuotesRequest = fiatramps.v1.GetQuotesRequest;
import GetRatesRequest = fiatramps.v1.GetRatesRequest;
import GetSupportedCountriesRequest = fiatramps.v1.GetSupportedCountriesRequest;
import GetTransactionFeeRequest = fiatramps.v1.GetTransactionFeeRequest;
import ResolveBankAccountRequest = fiatramps.v1.ResolveBankAccountRequest;
import UpdateCollectionTransactionStatusRequest = fiatramps.v1.UpdateCollectionTransactionStatusRequest;
import UpdatePaymentTransactionStatusRequest = fiatramps.v1.UpdatePaymentTransactionStatusRequest;
import YellowCardRetailCustomer = fiatramps.v1.YellowCardRetailCustomer;
import SafeHavenService from '@/app/SafeHaven/SafeHavenService';
import slugify from 'slugify';

class FiatRampsRpcService {
    public static async getSupportedCountries() {
        const cacheKey = 'supported_countries';
        const cachedCountries = await redis.get(cacheKey);

        if (cachedCountries && JSON.parse(cachedCountries).length !== 0) {
            return z.array(supportedCountry).parse(JSON.parse(cachedCountries));
        }

        const request = new GetSupportedCountriesRequest();
        const response = await getSupportedCountries(request);

        const { countries } = response.toObject();

        if (!countries) {
            throw new Error('Invalid response');
        }

        const parsedCountries = z
            .array(supportedCountry)
            .parse(transformKeysToCamelCase(countries));
        await redis.set(cacheKey, JSON.stringify(parsedCountries));

        return parsedCountries;
    }

    public static async getRates(targetCurrencies: string[] = []) {
        const request = new GetRatesRequest({
            target_currencies: targetCurrencies,
        });

        const response = await getRates(request);

        const { rates } = response.toObject();

        if (!rates) {
            throw new Error('Invalid Response');
        }

        return z.array(ratesSchema).parse(rates);
    }

    public static async getQuotes(
        currencySymbol: string,
        countryCode: CountryCode,
        route: 'onramp' | 'offramp'
    ) {
        const request = new GetQuotesRequest({
            country_code: countryCode,
            currency_symbol: currencySymbol,
        });

        const response = await getQuotes(request);

        const { fees, rate } = response.toObject();

        if (!fees || !rate) {
            throw new Error('Invalid response');
        }

        const quotes = quoteSchema.parse({
            fees: transformKeysToCamelCase(fees),
            rate: transformKeysToCamelCase(rate),
        });

        const txRate = route === 'onramp' ? quotes.rate.buy : quotes.rate.sell;
        const feePercentage =
            route === 'onramp' ? quotes.fees.onrampFeePercentage : quotes.fees.offrampFeePercentage;

        const minFeeUsd = route === 'onramp' ? 0 : quotes.fees.offrampMinFeeUsd;

        return {
            rate: txRate,
            fee: defaultAmountFixer(feePercentage / HUNDRED),
            rawFeePercentage: feePercentage,
            minFeeUsd: minFeeUsd,
            conditionalFeePercentConfigs: quotes.fees.conditionalFeePercentConfigs,
        };
    }

    public static async getCurrencyRates(currencySymbol: string) {
        const rates = await this.getRates([currencySymbol]);

        if (!rates[0]) {
            throw new Error(`Rate not found for currency: ${currencySymbol}`);
        }

        return rates[0];
    }

    public static async getBeneficiaries(
        ownerId: string,
        countryCode: CountryCode,
        accountType: 'bank' | 'phone' | undefined = undefined
    ) {
        const request = new GetBeneficiariesRequest({
            owner_id: ownerId,
            country_code: countryCode,
            account_type: accountType,
        });

        const response = await getBeneficiaries(request);

        if (!response.beneficiaries) {
            throw new Error('Invalid response');
        }

        return response.beneficiaries.map(this.parseBeneficiary);
    }

    private static parseBeneficiary(beneficiary: fiatramps.v1.Beneficiary) {
        const deserializedBeneficiary = beneficiary.toObject();

        if (deserializedBeneficiary.account_type === 'bank') {
            return {
                accountNumber: deserializedBeneficiary.account_number!,
                accountName: deserializedBeneficiary.account_name!,
                bankName: deserializedBeneficiary.provider_name!,
                country: transformKeysToCamelCase(deserializedBeneficiary.country),
                countryId: deserializedBeneficiary.country?.id!,
                channelId: deserializedBeneficiary.channel_id!,
                networkId: deserializedBeneficiary.network_id!,
                id: deserializedBeneficiary.id!,
                nameEnquiryReference: deserializedBeneficiary.name_enquiry_reference!,
                seerbitId: deserializedBeneficiary.seerbit_id!
            } satisfies BankBeneficiary;
        }

        const [firstName, lastName] = (deserializedBeneficiary.account_name ?? '')
            .trim()
            .split(' ');

        return {
            mobileNumber: deserializedBeneficiary.account_number!,
            country: transformKeysToCamelCase(deserializedBeneficiary.country),
            countryId: deserializedBeneficiary.country?.id!,
            channelId: deserializedBeneficiary.channel_id!,
            networkId: deserializedBeneficiary.network_id!,
            id: deserializedBeneficiary.id!,
            mobileProvider: deserializedBeneficiary.provider_name!,
            firstName: firstName,
            lastName: lastName,
        } satisfies MobileMoneyBeneficiary;
    }

    public static async getBeneficiary(beneficiaryId: string) {
        const cacheKey = `beneficiary_${beneficiaryId}`;
        const cachedBeneficiary = await redis.get(cacheKey);

        if (cachedBeneficiary) {
            return JSON.parse(cachedBeneficiary) as BankBeneficiary | MobileMoneyBeneficiary;
        }

        const request = new GetBeneficiaryRequest({
            beneficiary_id: beneficiaryId,
        });

        const response = await getBeneficiary(request);

        const parsedBeneficiary = this.parseBeneficiary(response);

        await redis.set(cacheKey, JSON.stringify(parsedBeneficiary));

        return parsedBeneficiary;
    }

    public static async getPaymentMethods(countryCode: CountryCode, route: 'onramp' | 'offramp') {
        const rampType = route === 'onramp' ? 'deposit' : 'withdraw';
        const request = new GetPaymentMethodsRequest({
            country_code: countryCode,
            route: rampType,
        });

        const response = await getPaymentMethods(request);

        const { channels, limits } = response.toObject();

        const parsedData = paymentMethodsResponseDataSchema.parse({
            channels: transformKeysToCamelCase(channels),
            limits: transformKeysToCamelCase(limits),
        });

        return {
            paymentChannels: parsedData.channels,
            countryFiatLimits: parsedData.limits,
        };
    }

    public static async getTransactionFee(countryCode: CountryCode, route: 'onramp' | 'offramp') {
        const request = new GetTransactionFeeRequest({
            country_code: countryCode,
        });

        const response = await getTransactionFees(request);

        const { offramp_fee_percentage, onramp_fee_percentage } = response.toObject();

        if (offramp_fee_percentage === undefined || onramp_fee_percentage === undefined) {
            throw new Error('Invalid response');
        }

        return route === 'onramp'
            ? defaultAmountFixer(onramp_fee_percentage / HUNDRED)
            : defaultAmountFixer(offramp_fee_percentage / HUNDRED);
    }

    public static async getNetwork(data: { networkId: string, countryCode: CountryCode, channelId: string }) {

        const { networkId, countryCode, channelId } = data;

        const networks = await this.getPaymentNetworks(countryCode, channelId);

        const network = networks.find(bank => bank.networkId === networkId);

        if (!network) throw new Error(`Network not found`);

        return network;
    }

    public static async getPaymentNetworks(countryCode: CountryCode, channelId: string) {

        const request = new GetPaymentNetworksRequest({
            country_code: countryCode,
            channel_id: channelId,
        });

        const response = await getPaymentNetworks(request);

        const { networks } = response.toObject();

        if (request.country_code === 'NG') {

            const yellowCardBanks = z.array(supportedPaymentNetworkSchema).parse(transformKeysToCamelCase(networks));

            const saveHavenBanks = await SafeHavenService.getSupportedBanks();

            const commonBanks = saveHavenBanks.reduce<supportedPaymentNetworkType[]>((accumulator, saveHavenBank) => {

                const matchingYellowCardBank = yellowCardBanks.find((bank) => {
                    return (
                        saveHavenBank.slug === slugify(bank.name, { lower: true, replacement: '-' })
                        || saveHavenBank.bankCode === bank.seerbitId
                    );
                });

                if (matchingYellowCardBank) {
                    accumulator.push({
                        channelId: matchingYellowCardBank.channelId,
                        networkId: matchingYellowCardBank.networkId,
                        seerbitId: saveHavenBank.bankCode,
                        name: saveHavenBank.name
                    });
                }
                return accumulator;
            }, []);

            return commonBanks;

        }

        return z.array(supportedPaymentNetworkSchema).parse(transformKeysToCamelCase(networks));
    }

    public static async addBeneficiary(
        ownerId: string,
        countryCode: CountryCode,
        accountType: 'bank' | 'phone',
        params: CreateBeneficiaryParams
    ) {

        const beneficiaryDetails =
            'firstName' in params.beneficiary
                ? (() => ({
                    accountName: `${params.beneficiary.firstName.trim()} ${params.beneficiary.lastName.trim()}`,
                    accountType: accountType,
                    accountNumber: params.beneficiary.mobileNumber,
                    networkName: params.beneficiary.mobileProvider,
                    nameEnquiryReference: '',
                    seerbitId: ''
                }))()
                : (() => ({
                    accountName: params.beneficiary.accountName,
                    accountType: accountType,
                    accountNumber: params.beneficiary.accountNumber,
                    networkName: params.beneficiary.bankName,
                    nameEnquiryReference: params.beneficiary.nameEnquiryReference,
                    seerbitId: params.beneficiary.seerbitId
                }))();

        console.log('received', beneficiaryDetails.seerbitId);

        const request = new AddBeneficiaryRequest({
            account_name: beneficiaryDetails.accountName
                .trim()
                .replaceAll(',', '')
                .replaceAll('/', '-'),
            account_number: beneficiaryDetails.accountNumber.replace(/\s/g, ''),
            account_type: beneficiaryDetails.accountType,
            network_id: params.beneficiary.networkId,
            channel_id: params.beneficiary.channelId,
            country: countryCode,
            network_name: beneficiaryDetails.networkName.trim(),
            name_enquiry_reference: beneficiaryDetails.nameEnquiryReference,
            seerbit_id: beneficiaryDetails.seerbitId,
            owner_id: ownerId,

        });

        const response = await addBeneficiary(request);

        const { new_beneficiary_id } = response.toObject();

        if (!new_beneficiary_id) throw new Error('Invalid response from addBeneficiary');

        return new_beneficiary_id;
    }

    public static async createBeneficiaryOfframpRequest(params: SendOfframpRequestPayload) {
        const validatedParams = sendOfframpRequestPayloadSchema.parse(params);
        const user = await userServiceV2.getWhatsappUserIdentityInfo(params.userId);

        if (!user) throw new Error('User not found');

        const standardizedUserPhoneNumber = `+${user.phoneNumber}`;

        let senderName = '';
        if (user.firstName) {
            senderName += user.firstName;
        }
        if (user.lastName) {
            senderName += ` ${user.lastName}`;
        }

        const request = new CreateBeneficiaryPaymentRequestInput({
            beneficiary_id: validatedParams.beneficiaryId,
            local_amount: validatedParams.localAmount,
            usd_amount: validatedParams.usdAmount,
            owner_id: validatedParams.userId,
            blockchain_network: validatedParams.chainName,
            token_address: validatedParams.tokenAddress,
            token_symbol: validatedParams.tokenName,
            from_wallet_address: validatedParams.userWalletAddress,
            transaction_hash: validatedParams.txHash,
            platform_fee_percentage: validatedParams.platformFeePercentage,
            hot_wallet_address: validatedParams.hotWalletAddress,
            conversion_rate: validatedParams.conversionRate,
            sender: new YellowCardRetailCustomer({
                name: senderName,
                phone: standardizedUserPhoneNumber.replace(/\s/g, ''),
                country: user.country,
                dob: user.kycDateOfBirth,
                id_number: user.kycDocumentNumber.replace(/\s/g, ''),
                id_type: user.kycIdType,
                address: user.address ?? FALLBACK_USE_AZZA_ADDRESS,
                additional_id_number: user.additionalKycIdNumber?.replace(/\s/g, '') ?? undefined,
                additional_id_type: user.additionalKycIdType ?? undefined,
            }),
            transaction_fee_usd: validatedParams.transactionFeeUsd,
        });

        const response = await createBeneficiaryPaymentRequest(request);
        const offrampResponse = response.toObject();
        if (!offrampResponse.sequence_id) throw new Error('Invalid response from offramp service');

        return offrampResponse.sequence_id;
    }

    public static async createPlatformOnrampRequest(params: OnrampTransactionPayload) {
        let recipientName = '';
        if (params.userDetails.firstName) {
            recipientName += params.userDetails.firstName;
        }
        if (params.userDetails.lastName) {
            recipientName += ` ${params.userDetails.lastName}`;
        }

        const request = new CreatePlatformCollectionRequestInput({
            owner_id: params.customerId,
            source: new CollectionSource({
                account_type: params.accountType === 'phone' ? 'momo' : params.accountType,
                account_number: params.accountNumber?.replace(/\s/g, ''),
                network_id: params.networkId?.replace(/\s/g, ''),
            }),
            recipient: new YellowCardRetailCustomer({
                name: recipientName,
                phone: `+${params.userDetails.phoneNumber}`,
                country: params.userDetails.country,
                address: params.userDetails.address ?? FALLBACK_USE_AZZA_ADDRESS,
                dob: params.userDetails.kycDateOfBirth,
                id_number: params.userDetails.kycDocumentNumber.replace(/\s/g, ''),
                id_type: params.userDetails.kycIdType,
                additional_id_number:
                    params.userDetails.additionalKycIdNumber?.replace(/\s/g, '') ?? undefined,
                additional_id_type: params.userDetails.additionalKycIdType ?? undefined,
            }),
            token_symbol: params.tokenName,
            blockchain_network: params.chainName,
            destination_wallet_address: params.userWalletAddress.replace(/\s/g, ''),
            platform_fee_percentage: params.platformFeePercentage,
            conversion_rate: params.conversionRate,
            usd_amount: params.usdAmount,
            local_amount: params.localAmount,
            channel_id: params.channelId,
            transaction_fee_usd: params.transactionFeeUsd,
            collection_country_code: params.country,
        });

        const response = await createPlatformCollection(request);

        return sendOnrampTransactionResponseSchema.parse(
            transformKeysToCamelCase(response.toObject())
        );
    }

    public static async getOfframpTransactionStatus(sequenceId: string) {
        return (await this.getOfframpTransaction(sequenceId)).status;
    }

    public static async getOnrampTransactionStatus(sequenceId: string) {
        return (await this.getOnrampTransaction(sequenceId)).status;
    }

    public static async getOnrampTransaction(sequenceId: string) {
        const request = new GetCollectionRequestTransactionRequest({
            sequence_id: sequenceId,
        });

        const response = await getCollectionRequestTransaction(request);

        const responseObj = response.toObject();

        return onrampTransactionRecordSchema.parse(transformKeysToCamelCase(responseObj));
    }

    public static async forwardOnrampTransactionStatus(sequenceId: string, status: string) {
        const request = new UpdateCollectionTransactionStatusRequest({
            sequence_id: sequenceId,
            status: status,
        });

        await updateCollectionTransactionStatus(request);
    }

    public static async forwardOfframpTransactionStatus(sequenceId: string, status: string) {
        const request = new UpdatePaymentTransactionStatusRequest({
            sequence_id: sequenceId,
            status: status,
        });

        await updatePaymentTransactionStatus(request);
    }

    public static async getOfframpTransaction(sequenceId: string) {
        const request = new GetPaymentRequestTransactionRequest({
            sequence_id: sequenceId,
        });

        const response = await getPaymentRequestTransaction(request);

        const responseObj = response.toObject();

        return OfframpTransactionRecordSchema.parse(transformKeysToCamelCase(responseObj));
    }

    public static async getHotWalletAddress(networkType: PlatformAddressIdNetworkTag) {
        const request = new GetHotWalletAddressRequest({
            network_type: networkType,
        });

        const response = await getHotWalletAddress(request);
        const { address } = response.toObject();

        if (!address) throw new Error('Hot wallet address not found');

        return address;
    }

    public static async resolveBankAccount(params:
        {
            networkId: string;
            accountNumber: string,
            countryCode: string,
            seerbitId: string
        }) {
        try {

            if (params.countryCode === 'NG') {
                const response = await SafeHavenService.accountNameEnquiry({
                    bankCode: params.seerbitId,
                    accountNumber: params.accountNumber
                })

                return resolveBankAccountSchema.parse(response);
            }

            const request = new ResolveBankAccountRequest({
                network_id: params.networkId,
                account_number: params.accountNumber
            });

            const response = await resolveBankAccount(request);

            return resolveBankAccountSchema.parse(transformKeysToCamelCase(response.toObject()));

        } catch (error) {
            void logger.error('Error resolving bank account', { error });
            return null;
        }
    }
}

export default FiatRampsRpcService;
