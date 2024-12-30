import env from '@/constants/env';
import crypto from 'node:crypto';
import { HttpException } from '@/resources/exceptions/HttpException';
import {
    WebhookPayloadDigestAlgorithms,
    webhookPayloadDigestSchema,
    WebhookPayloadDigestConfig,
} from './sumSubSchema';
import { BAD_REQUEST, NOT_FOUND, UNAUTHORIZED } from '@/constants/status-codes';
import { UserRecord } from '@/db/xata';
import UserService from '@/app/User/UserService';
import logger from '@/resources/logger';
import axios from 'axios';
import WhatsAppBotService from '@/app/WhatsAppBot/WhatsAppBotService';

type UsedSumSubRequestMethods = 'GET' | 'POST';

type AccessSignatureInput = `${number}${UsedSumSubRequestMethods}${string}`;

type ConcernedWebhookEvents =
    | 'applicantReviewed'
    | 'applicantPending'
    | 'applicantReset'
    | 'applicantDeleted';

type WebhookEventHandlers = {
    [key in WebhookPayload['type']]: (
        payload: WebhookPayload,
        user: UserRecord,
        applicantData?: ApplicantData
    ) => Promise<void>;
};

interface WebhookPayload {
    levelName: string;
    applicantType: 'individual' | 'company';
    type: ConcernedWebhookEvents;
    applicantId?: string;
    externalUserId?: string;
    correlationId?: string;
    reviewResult?: {
        reviewAnswer: 'RED' | 'GREEN';
        moderationComment?: string;
        clientComment?: string;
        rejectLabels?: Array<string>;
    };
}

interface ApiRequestHeadersConfig {
    requestUri: string;
    bodyString?: string;
    requestMethod: UsedSumSubRequestMethods;
    appSecret: string;
    appToken: string;
}

interface ApplicantData {
    id: string;
    inspectionId: string;
    externalUserId: string;
    info: {
        legalName: string;
        firstName: string;
        middleName?: string;
        lastName: string;
        country: string;
        dob: string;
        idDocs: Array<{
            idDocType: string;
            number: string;
            country: string;
        }>;
    };
    ipCountry: string;
    phone: string;
    requiredIdDocs: {
        docSets: Array<{
            idDocSetType: 'IDENTITY';
            types: Array<string>;
        }>;
    };
    metadata: Array<{
        key: string;
        value: string;
    }>;
}

export const DEFAULT_KYC_LEVEL_NAME = 'Azza-verification' as const;
export const NG_KYC_LEVEL_NAME = 'Azza-verification-Nigeria' as const;

const BVN_METADATA_KEY = 'BVN Number' as const;
const NIN_METADATA_KEY = 'NIN' as const;

class SumSubService {
    private static APP_TOKEN = env.SUM_SUB_APP_TOKEN;

    private static APP_TOKEN_SECRET = env.SUM_SUB_APP_TOKEN_SECRET;

    private static WEBHOOK_PRIVATE_KEY = env.SUM_SUB_WEBHOOK_PRIVATE_KEY;

    private static BASE_API_URL = 'https://api.sumsub.com';

    private static readonly API_TTL_IN_SECS = 600;

    public static readonly SERVICE_IS_ACTIVE = true;

    public static withConfig(params: {
        appToken: string;
        appTokenSecret: string;
        baseUrl: string;
    }) {
        this.APP_TOKEN = params.appToken;
        this.APP_TOKEN_SECRET = params.appTokenSecret;
        this.BASE_API_URL = params.baseUrl;

        return this;
    }

    private static generateAccessSignature(input: AccessSignatureInput, secret: string) {
        const sha256Hash = crypto.createHmac('sha256', secret);

        sha256Hash.update(input);

        return sha256Hash.digest('hex');
    }

    private static generateRequiredApiRequestHeaders(config: ApiRequestHeadersConfig) {
        const { requestMethod, requestUri, bodyString } = config;

        const requestTime = Math.floor(Date.now() / 1000);

        const accessSignatureInput: AccessSignatureInput = `${requestTime}${requestMethod}${requestUri}${
            bodyString ?? ''
        }`;

        const appAccessSignature = this.generateAccessSignature(
            accessSignatureInput,
            this.APP_TOKEN_SECRET
        );

        return {
            'X-App-Access-Ts': `${requestTime}`,
            'X-App-Access-Sig': appAccessSignature,
            'X-App-Token': this.APP_TOKEN,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        };
    }

    public static async generateKycUrl(userPhoneNumber: string, levelName: string) {
        const requestQueryParams = new URLSearchParams({
            levelName: levelName,
            externalUserId: userPhoneNumber,
            ttlInSecs: `${this.API_TTL_IN_SECS}`,
            lang: 'en',
        });

        const requestUri = `/resources/sdkIntegrations/levels/${levelName}/websdkLink?${requestQueryParams.toString()}`;
        const requestMethod: UsedSumSubRequestMethods = 'POST';
        const endpoint = `${this.BASE_API_URL}${requestUri}`;
        const body = {
            phone: userPhoneNumber,
        };

        const requestHeaders = this.generateRequiredApiRequestHeaders({
            requestUri,
            requestMethod,
            bodyString: JSON.stringify(body),
            appSecret: this.APP_TOKEN_SECRET,
            appToken: this.APP_TOKEN,
        });

        const response = await axios.post<{ url: string }>(endpoint, body, {
            headers: requestHeaders,
        });

        return response.data.url;
    }

    public static validateWebhookPayload(config: WebhookPayloadDigestConfig) {
        const { payload, payloadDigest, payloadDigestAlgorithm } = config;

        try {
            webhookPayloadDigestSchema.parse(config);
        } catch (error) {
            throw new HttpException(BAD_REQUEST, 'Invalid payload config');
        }

        const algorithm = WebhookPayloadDigestAlgorithms[payloadDigestAlgorithm];

        const calculatedDigest = crypto
            .createHmac(algorithm, this.WEBHOOK_PRIVATE_KEY)
            .update(payload)
            .digest('hex');

        const digestIsValid = calculatedDigest === payloadDigest;

        if (!digestIsValid) throw new HttpException(UNAUTHORIZED, 'Invalid payload digest');

        try {
            return JSON.parse(payload) as WebhookPayload;
        } catch (error) {
            throw new HttpException(BAD_REQUEST, 'Could not parse webhook payload');
        }
    }

    public static extractUserInformation(applicantData: ApplicantData) {
        const { info, requiredIdDocs, phone, metadata } = applicantData;

        const { firstName, lastName, idDocs, dob } = info;

        const userInfo: {
            firstName: string;
            lastName: string;
            country: string;
            kycDateOfBirth: string;
            kycDocumentNumber: string;
            kycIdType: string;
            phoneNumber?: string;
            additionalKycIdType?: string;
            additionalKycIdNumber?: string;
        } = {
            kycIdType: '',
            kycDateOfBirth: '',
            firstName: '',
            lastName: '',
            country: '',
            kycDocumentNumber: '',
        };

        const identityDocSet = requiredIdDocs.docSets.find(
            (docSet) => docSet.idDocSetType === 'IDENTITY'
        );

        const bvnMetadata = metadata
            ? metadata.find((meta) => meta.key.toLowerCase() === BVN_METADATA_KEY.toLowerCase())
            : undefined;
        const ninMetadata = metadata
            ? metadata.find((meta) => meta.key.toLowerCase() === NIN_METADATA_KEY.toLowerCase())
            : undefined;

        // ID info
        if (identityDocSet) {
            const docTypes = identityDocSet.types;

            const identityDoc = idDocs.find((doc) => docTypes.includes(doc.idDocType));

            if (identityDoc) {
                userInfo['kycIdType'] = identityDoc.idDocType;
                userInfo['kycDocumentNumber'] = identityDoc.number;
                userInfo['country'] = identityDoc.country;
            }
        }

        if (ninMetadata) {
            // Use the  NIN for Non-NIN ID Cards

            if (userInfo['kycIdType'] !== 'ID_CARD') {
                userInfo['kycIdType'] = 'NIN';
                userInfo['kycDocumentNumber'] = ninMetadata.value;
            }

            // If the user used an ID_CARD, and it contains alphanumeric characters, we can assume it's a Voter's Card
            if (
                userInfo['kycIdType'] === 'ID_CARD' &&
                userInfo['kycDocumentNumber'].match(/[a-z]/i)
            ) {
                userInfo['kycIdType'] = 'NIN';
                userInfo['kycDocumentNumber'] = ninMetadata.value;
            }
        }

        if (bvnMetadata) {
            userInfo['additionalKycIdType'] = 'BVN';
            userInfo['additionalKycIdNumber'] = bvnMetadata.value;
        }

        userInfo['firstName'] = firstName ?? '';
        userInfo['lastName'] = lastName ?? '';
        userInfo['kycDateOfBirth'] = dob;
        userInfo['phoneNumber'] = phone;

        return userInfo;
    }

    private static getWebhookEventHandlers(event: WebhookPayload['type']) {
        const eventHandlers: WebhookEventHandlers = {
            async applicantReviewed(payload, user, applicantData) {
                const { reviewResult } = payload;

                if (!reviewResult) return;

                const isVerified = reviewResult.reviewAnswer === 'GREEN';

                if (isVerified) {
                    const userInfo = SumSubService.extractUserInformation(applicantData!);

                    await WhatsAppBotService.sendKycVerifiedMessage(user.phoneNumber!);

                    return await UserService.updateUserInfoFromKyc(user, {
                        ...userInfo,
                        kycStatus: 'VERIFIED',
                    });
                }

                await WhatsAppBotService.sendKycRejectedMessage(user.phoneNumber!);

                await UserService.updateUserKycStatus(user, 'REJECTED');
            },

            async applicantPending(_, user) {
                await UserService.updateUserKycStatus(user, 'IN_REVIEW');
            },

            async applicantReset(_, user) {
                await UserService.updateUserKycStatus(user, null);
            },

            async applicantDeleted(_, user) {
                await UserService.updateUserKycStatus(user, null);
            },
        };

        return eventHandlers[event];
    }

    public static async getApplicantData(applicantId: string) {
        const requestMethod: UsedSumSubRequestMethods = 'GET';

        const requestUri = `/resources/applicants/${applicantId}/one`;

        const endpoint = `${this.BASE_API_URL}${requestUri}`;

        const requestHeaders = this.generateRequiredApiRequestHeaders({
            requestUri,
            requestMethod,
            appSecret: this.APP_TOKEN_SECRET,
            appToken: this.APP_TOKEN,
        });

        const response = await fetch(endpoint, {
            method: requestMethod,
            headers: requestHeaders,
        });

        if (!response.ok) throw new HttpException(response.status, 'Getting applicant data failed');

        const data = (await response.json()) as ApplicantData;

        return data;
    }

    public static async handleWebhookEvent(payload: WebhookPayload) {
        const handler = this.getWebhookEventHandlers(payload.type);

        if (!handler) {
            logger.warn(`Abort: No handler for event '${payload.type}'`);
            return;
        }

        if (!payload.applicantId) {
            throw new HttpException(BAD_REQUEST, 'Applicant ID not present');
        }

        logger.info('Fetching applicant data');

        const applicantData = await this.getApplicantData(payload.applicantId);

        const { externalUserId } = applicantData;

        if (!externalUserId) {
            throw new HttpException(NOT_FOUND, 'No External ID found in applicant data');
        }

        const user = await UserService.getUserByPhoneNumber(externalUserId);

        if (!user) {
            throw new HttpException(NOT_FOUND, 'User not found');
        }

        logger.info(`Handling event for ${payload.type}`);

        const verifiedUser = {
            ...user,
            refreshToken: '',
        };

        await handler(payload, verifiedUser, applicantData);

        logger.info(`Event handled for ${payload.type}`);
    }
}

export default SumSubService;
