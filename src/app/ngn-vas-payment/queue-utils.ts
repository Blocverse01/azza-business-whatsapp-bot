import { getAssetConfigOrThrow } from "@/config/whatsAppBot";
import { Worker } from 'bullmq';
import azzaWalletManager from "@/runtime/wallet";
import FiatRampService from "../FiatRamp/FiatRampService";
import { defaultQueueRemoveOptions, queues } from "@/background-processing/queues";
import { convertBase64ToAsciiString, encryptWithAES } from "@/resources/utils/encryption";
import env from "@/constants/env";
import { AirtimePayload, DataPayload, PaymentTransactionDetails, RecipientInfo, transactionType, UtilityPayload } from "./types";
import { logServiceError } from "@/resources/requestHelpers/handleRequestError";
import userServiceV2 from "@/runtime/user";
import SafeHavenService from "../NigeriaBanks/SafeHaven/SafeHavenService";
import { VASServiceType } from "../NigeriaBanks/SafeHaven/SafeHaveSchema";
import { NGNVasTransactionQueueInput, QueueNames } from "@/background-processing/types";
import { SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID } from "../FiatRamp/config";
import { HttpException } from "@/resources/exceptions/HttpException";
import { NOT_FOUND } from "@/constants/status-codes";
import { prettifyNumber } from "@/resources/utils/currency";
import { transactionStatusSchema } from "../FiatRamp/fiatRampSchema";
import { connectionConfig } from "@/background-processing/redis-connection-config";
import NigeriaBanksService from "../NigeriaBanks/NigeriaBanksService";
import WhatsAppBotService from "../WhatsAppBot/WhatsAppBotService";
import { generateBillPaymentReceipt } from "../receipts/generators";
import { NgnVasSettlementTransactionRecord } from "@/db/xata";

export type TransactionType = 'data' | 'airtime';

export const addNgnVasPaymentJobForProcessing = async (
    jobId: string,
    params: PaymentTransactionDetails
) => {

    const { transactionDetailsParams, ngnVasDetailsParams } = params;

    const assetConfig = getAssetConfigOrThrow(transactionDetailsParams.assetId);

    const [assetBalanceInfo, userWallet, user, hotWalletAddress] = await Promise.all([
        azzaWalletManager.getAssetBalance({
            userId: convertBase64ToAsciiString(transactionDetailsParams.userId),
            assetId: transactionDetailsParams.assetId,
        }),
        azzaWalletManager.getUserWallet(transactionDetailsParams.userId, assetConfig.network),
        userServiceV2.getUserById(convertBase64ToAsciiString(transactionDetailsParams.userId)),
        FiatRampService.getHotWalletForNetwork(assetConfig.network),
    ]);

    if (!user) {
        throw new Error('User not found');
    }

    const assetBalance = assetBalanceInfo.balance;

    if (assetBalance < transactionDetailsParams.tokenAmountToDebit) {
        const insufficientBalanceMessage = `You're trying to pay: ${transactionDetailsParams.tokenAmountToDebit} ${assetConfig.tokenName}\nYou have only: ${assetBalance} ${assetConfig.tokenName}`;

        return {
            status: 'failed',
            message: insufficientBalanceMessage,
        };
    }

    const recipient = ngnVasDetailsParams
        ? buildRecipient(ngnVasDetailsParams.type, ngnVasDetailsParams.payload)
        : null;

    if (!recipient) {
        throw new Error('Recipient details is required');
    }

    try {

        //create a ngn vas settlement
        const vas_settlement = await SafeHavenService.createVasPaymentSettlement({
            blockchainNetwork: assetConfig.network,
            usdAmount: transactionDetailsParams.usdAmount,
            localAmount: transactionDetailsParams.fiatAmount,
            localCurrencySymbol: 'NGN',
            tokenSymbol: assetConfig.tokenName,
            ownerId: user.id,
            recipient,
            rate: transactionDetailsParams.conversionRate,
            hotWalletAddress: hotWalletAddress,
            platformFeePercentage: 0,
            tokenAddress: assetConfig.tokenAddress,
            processorName: 'safehaven',
            fromWalletAddress: assetConfig.tokenAddress,
            transactionFeeUsd: 0,
            transactionType: ngnVasDetailsParams?.type!
        });

        // Process in background and return early processing response
        await queues.eventDrivenOfframp.add(
            'initiate offramp request',
            {
                offrampParams: {
                    beneficiaryId: transactionDetailsParams.beneficiaryId ?? null,
                    usdAmount: transactionDetailsParams.usdAmount,
                    localAmount: transactionDetailsParams.fiatAmount,
                    userWalletAddress: userWallet.address,
                    hotWalletAddress,
                    userId: transactionDetailsParams.userId,
                    platformFeePercentage: transactionDetailsParams.platformFeePercentage,
                    conversionRate: transactionDetailsParams.conversionRate,
                    transactionFeeUsd: transactionDetailsParams.transactionFeeUsd,
                    assetId: transactionDetailsParams.assetId,
                    tokenAmountToDebit: transactionDetailsParams.tokenAmountToDebit,
                    transactionType: transactionType,
                    ngnVasSettlementId: vas_settlement.id
                },
                transactionPin: encryptWithAES(
                    transactionDetailsParams.transactionPin,
                    env.SECURITY_QUESTIONS_MASK_KEY,
                    env.SECURITY_QUESTIONS_MASK_IV
                ),
                ngnVasParams: {
                    type: ngnVasDetailsParams?.type!,
                    payload: ngnVasDetailsParams?.payload!
                },
                whatsappParams: {
                    userPhoneNumber: transactionDetailsParams.userPhoneNumber,
                    businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                },
            },
            {
                ...defaultQueueRemoveOptions,
                jobId,
            }
        );

        return {
            status: 'processing',
            message:
                "Your transaction is currently being processed, we'd send updates on the status of your transaction in your DM",
        };

    } catch (error) {
        await logServiceError(error, 'Processing utility transaction failed');

        return {
            status: 'failed',
            message: 'Transaction failed',
        };
    }

};


const buildRecipient = (
    vasType: VASServiceType,
    payload: AirtimePayload | DataPayload | UtilityPayload
): RecipientInfo => {
    const base: RecipientInfo = { country: 'NG', distributionName: payload.distributionName };

    switch (vasType) {
        case VASServiceType.AIRTIME: {
            const { phoneNumber, serviceCategoryId } = payload as AirtimePayload;
            return {
                ...base,
                recipientPhoneNumber: phoneNumber,
                serviceCategoryId,
            };
        }

        case VASServiceType.DATA: {
            const { phoneNumber, serviceCategoryId, bundleCode } = payload as DataPayload;
            return {
                ...base,
                recipientPhoneNumber: phoneNumber,
                serviceCategoryId,
                bundleCode
            };
        }

        case VASServiceType.UTILITY: {
            const { meterNumber, serviceCategoryId } = payload as UtilityPayload;
            return {
                ...base,
                recipientMeterNumber: meterNumber,
                serviceCategoryId,
            };
        }

        default:
            throw new Error(`Unsupported VAS service type: ${vasType}`);
    }
};


export const addNgnVasTransactionUpdateJobToQueue = async (
    input: NGNVasTransactionQueueInput
) => {

    const jobId = `${input.processorName}-transaction-${input.transactionId}`;
    return queues.handleNGNVasTransactionStatusUpdate.add(jobId, input, {
        jobId,
        removeOnComplete: false,
    });
};

export const createNgnVasTransactionUpdateJobWorker = () => {
    return new Worker<NGNVasTransactionQueueInput>(
        QueueNames.handleNGNVasTransactionStatusUpdate,
        async (job) => {

            const { transactionId } = job.data;

            const settlement =
                await SafeHavenService.getNGNVasProcessingTransaction(transactionId);
            
            const transaction = await (async () => {
                if (settlement.processorName === SAFEHAVEN_OFFRAMP_PAYMENT_PROCESSOR_ID) {
                    return await SafeHavenService.getSafeHavenVasPaymentByTransactionId(
                        settlement.sequenceId as string
                    );
                } else {
                    throw new HttpException(NOT_FOUND, 'processor name not found');
                }
            })();

            const userPhoneNumber = await userServiceV2.getUserPhoneNumber(settlement?.ownerId!);

            let transactionMessage = ''

            if (settlement.transactionType === 'airtime') {
                transactionMessage = `${settlement.localCurrencySymbol}${prettifyNumber(settlement.localAmount!)} top-up to ${settlement.recipientPhoneNumber}`;
            }

            if (settlement.transactionType === 'data') {
                transactionMessage = `${settlement.distributionName?.toUpperCase()} ${settlement.bundleCode!} for ${settlement.localCurrencySymbol}${prettifyNumber(settlement.localAmount!)} to ${settlement.recipientPhoneNumber}`;
            }

            const transactionType = settlement.transactionType as TransactionType;

            if (
                transaction.status.toLowerCase() === 'completed' ||
                transaction.status.toLowerCase() === 'successful'
            ) {
                await settlement.update({
                    processingStatus: transactionStatusSchema.parse('complete'),
                });

                const completeMessage = transactionCompleteMessage(transactionType, transactionMessage);

                await NigeriaBanksService.sendArbitraryTextMessage(
                    completeMessage,
                    userPhoneNumber
                );

                const receiptBuffer = await generateBillPaymentReceipt(settlement as NgnVasSettlementTransactionRecord);
              
                const uploadedMedia = await WhatsAppBotService.uploadImageToWhatsapp(
                    env.WA_PHONE_NUMBER_ID,
                    new File([Buffer.from(receiptBuffer)], `receipt-${transactionId}.png`, {
                        type: 'image/png',
                    })
                );
                
                if (uploadedMedia) {
                    await WhatsAppBotService.sendMediaMessage(
                        {
                            userPhoneNumber: userPhoneNumber!,
                            businessPhoneNumberId: env.WA_PHONE_NUMBER_ID,
                        },
                        {
                            mediaId: uploadedMedia.id,
                            caption: `🧾Transaction Receipt`,
                            type: 'image',
                        }
                    );
                }

            } else {
                await settlement.update({
                    processingStatus: transactionStatusSchema.parse('failed'),
                });

                const failedMessage = transactionFailedMessage(transactionType, transactionMessage);

                await NigeriaBanksService.sendArbitraryTextMessage(failedMessage, userPhoneNumber);
            }
        },
        {
            connection: connectionConfig,
            concurrency: 20,
        }
    );
};


const transactionCompleteMessage = (
    txT: TransactionType,
    transactionDetailsString: string
) => {
    const message = `✅ Your ${txT === 'data' ? 'data bundle' : 'airtime'} transaction has been completed successfully:\n\n${transactionDetailsString}\n\n`;
    return message;
};


const transactionFailedMessage = (
    txT: TransactionType,
    transactionDetailsString: string
) => {
    return `❌ Your ${txT === 'data' ? 'data subscription' : 'airtime top-up'} failed:\n\n${transactionDetailsString}\n\nPlease contact support.`;
};
