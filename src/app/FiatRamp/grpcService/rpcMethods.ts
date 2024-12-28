import { promisifyUnary } from '@/app/FiatRamp/grpcService/utils';
import { fiatramps } from '@/proto/fiatramps/v1/service';
import GetSupportedCountriesRequest = fiatramps.v1.GetSupportedCountriesRequest;
import { client } from '@/app/FiatRamp/grpcService/config';
import GetRatesRequest = fiatramps.v1.GetRatesRequest;
import GetQuotesRequest = fiatramps.v1.GetQuotesRequest;
import FiatRampsServiceClient = fiatramps.v1.FiatRampsServiceClient;
import GetBeneficiariesRequest = fiatramps.v1.GetBeneficiariesRequest;
import GetBeneficiaryRequest = fiatramps.v1.GetBeneficiaryRequest;
import GetPaymentMethodsRequest = fiatramps.v1.GetPaymentMethodsRequest;
import GetPaymentMethodsResponse = fiatramps.v1.GetPaymentMethodsResponse;
import GetTransactionFeeRequest = fiatramps.v1.GetTransactionFeeRequest;
import GetTransactionFeeResponse = fiatramps.v1.GetTransactionFeeResponse;
import GetPaymentNetworksRequest = fiatramps.v1.GetPaymentNetworksRequest;
import GetPaymentNetworksResponse = fiatramps.v1.GetPaymentNetworksResponse;
import AddBeneficiaryRequest = fiatramps.v1.AddBeneficiaryRequest;
import AddBeneficiaryResponse = fiatramps.v1.AddBeneficiaryResponse;
import CreateBeneficiaryPaymentRequestInput = fiatramps.v1.CreateBeneficiaryPaymentRequestInput;
import CreatePaymentRequestResponse = fiatramps.v1.CreatePaymentRequestResponse;
import GetPaymentRequestTransactionRequest = fiatramps.v1.GetPaymentRequestTransactionRequest;
import GetPaymentRequestTransactionResponse = fiatramps.v1.GetPaymentRequestTransactionResponse;
import GetHotWalletAddressRequest = fiatramps.v1.GetHotWalletAddressRequest;
import GetHotWalletAddressResponse = fiatramps.v1.GetHotWalletAddressResponse;
import CreatePlatformCollectionRequestInput = fiatramps.v1.CreatePlatformCollectionRequestInput;
import CreateCollectionResponse = fiatramps.v1.CreateCollectionResponse;
import GetCollectionRequestTransactionRequest = fiatramps.v1.GetCollectionRequestTransactionRequest;
import GetCollectionRequestResponse = fiatramps.v1.GetCollectionRequestResponse;

// Wrap the gRPC methods as promises
export const getSupportedCountries = promisifyUnary<
    FiatRampsServiceClient,
    GetSupportedCountriesRequest,
    fiatramps.v1.GetSupportedCountriesResponse
>(client, 'GetSupportedCountries');

export const getRates = promisifyUnary<
    FiatRampsServiceClient,
    GetRatesRequest,
    fiatramps.v1.GetRatesResponse
>(client, 'GetRates');

export const getQuotes = promisifyUnary<
    FiatRampsServiceClient,
    GetQuotesRequest,
    fiatramps.v1.GetQuotesResponse
>(client, 'GetQuotes');

export const getBeneficiaries = promisifyUnary<
    FiatRampsServiceClient,
    GetBeneficiariesRequest,
    fiatramps.v1.GetBeneficiariesResponse
>(client, 'GetBeneficiaries');

export const getBeneficiary = promisifyUnary<
    FiatRampsServiceClient,
    GetBeneficiaryRequest,
    fiatramps.v1.Beneficiary
>(client, 'GetBeneficiary');

export const getPaymentMethods = promisifyUnary<
    FiatRampsServiceClient,
    GetPaymentMethodsRequest,
    GetPaymentMethodsResponse
>(client, 'GetPaymentMethods');

export const getTransactionFees = promisifyUnary<
    FiatRampsServiceClient,
    GetTransactionFeeRequest,
    GetTransactionFeeResponse
>(client, 'GetTransactionFee');

export const getPaymentNetworks = promisifyUnary<
    FiatRampsServiceClient,
    GetPaymentNetworksRequest,
    GetPaymentNetworksResponse
>(client, 'GetPaymentNetworks');

export const addBeneficiary = promisifyUnary<
    FiatRampsServiceClient,
    AddBeneficiaryRequest,
    AddBeneficiaryResponse
>(client, 'AddBeneficiary');

export const createBeneficiaryPaymentRequest = promisifyUnary<
    FiatRampsServiceClient,
    CreateBeneficiaryPaymentRequestInput,
    CreatePaymentRequestResponse
>(client, 'CreateBeneficiaryPaymentRequest');

export const getPaymentRequestTransaction = promisifyUnary<
    FiatRampsServiceClient,
    GetPaymentRequestTransactionRequest,
    GetPaymentRequestTransactionResponse
>(client, 'GetPaymentRequestTransaction');

export const getHotWalletAddress = promisifyUnary<
    FiatRampsServiceClient,
    GetHotWalletAddressRequest,
    GetHotWalletAddressResponse
>(client, 'GetHotWalletAddress');

export const createPlatformCollection = promisifyUnary<
    FiatRampsServiceClient,
    CreatePlatformCollectionRequestInput,
    CreateCollectionResponse
>(client, 'CreatePlatformCollectionRequest');

export const getCollectionRequestTransaction = promisifyUnary<
    FiatRampsServiceClient,
    GetCollectionRequestTransactionRequest,
    GetCollectionRequestResponse
>(client, 'GetCollectionRequestTransaction');

export const updateCollectionTransactionStatus = promisifyUnary<
    FiatRampsServiceClient,
    fiatramps.v1.UpdateCollectionTransactionStatusRequest,
    fiatramps.v1.UpdateCollectionTransactionStatusResponse
>(client, 'UpdateCollectionTransactionStatus');

export const resolveBankAccount = promisifyUnary<
    FiatRampsServiceClient,
    fiatramps.v1.ResolveBankAccountRequest,
    fiatramps.v1.ResolveBankAccountResponse
>(client, 'ResolveBankAccount');
