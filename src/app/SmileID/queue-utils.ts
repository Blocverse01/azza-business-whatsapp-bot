import { queues } from '@/background-processing/queues';
import {
    BvnKycVerificationWebhookBody,
    KycWebhookResultCode,
    SmileIdWebhookData,
} from './smile-id-schema';
import { Worker } from 'bullmq';
import { QueueNames } from '@/background-processing/types';
import SmileIdService, { BVN_VERIFICATION_JOB_ID_PREFIX } from './SmileIdService';
import { UserIdentityInfo } from '../User/userSchema';
import { UpdatableInfo } from '../User/UserServiceV2';
import MessageGenerators from '../WhatsAppBot/MessageGenerators';
import userServiceV2 from '@/runtime/user';
import WhatsAppBotService from '../WhatsAppBot/WhatsAppBotService';
import env from '@/constants/env';
import BvnKycVerificationFlow from '../WhatsAppBot/WhatsAppFlows/BvnKycVerificationFlow';
import { connectionConfig } from '@/background-processing/redis-connection-config';
import { compareUserKycInfoWithDecision } from '../kyc/self-service-resolution/utils';
import { generateKycRejectMessages } from '@/app/kyc/self-service-resolution/utils';
import { sendTechnicalIssueAlert } from '../support/whatsapp';

const NOT_AVAILABLE = 'Not Available';
const NG = 'NG';

const extractUserInfoToUpdate = (
    webhookData: SmileIdWebhookData,
    kycStatus: UserIdentityInfo['kycStatus']
): Partial<UpdatableInfo> => {
    if (kycStatus !== 'verified') {
        return {
            kycStatus,
        };
    }

    const userInfoToUpdate: Partial<UpdatableInfo> = {
        firstName: webhookData.FullData?.firstname,
        lastName: webhookData.FullData?.surname,
        country: webhookData.Country,
        kycDateOfBirth: webhookData.DOB,
        kycDocumentNumber: webhookData.IDNumber,
        kycIdType: webhookData.IDType,
        address: '',
        gender: webhookData.Gender,
        kycStatus: webhookData.Country === NG ? 'in_review' : 'verified',
    };

    if (webhookData.FullData?.middlename) {
        userInfoToUpdate.firstName += ` ${webhookData.FullData.middlename}`;
    }

    if (webhookData.Address && webhookData.Address.toLowerCase() !== NOT_AVAILABLE.toLowerCase()) {
        userInfoToUpdate['address'] = webhookData.Address;
    }

    const [firstName, middleName, lastName] = webhookData.FullName?.split(' ') ?? [];

    if (userInfoToUpdate.firstName?.trim() === '' && firstName) {
        userInfoToUpdate.firstName = `${firstName}` + (middleName ? ` ${middleName}` : '');
    }
    if (userInfoToUpdate.lastName?.trim() === '' && lastName) {
        userInfoToUpdate.lastName = lastName;
    }
    if (userInfoToUpdate.gender?.trim() === '' && webhookData.FullData?.gender) {
        userInfoToUpdate.gender = webhookData.FullData?.gender;
    }

    return userInfoToUpdate;
};

export const addKycEventJobToQueue = async (
    data: SmileIdWebhookData | BvnKycVerificationWebhookBody
) => {
    return await queues.handleSmileKycWebhook.add(
        `kyc-webhook-${data.PartnerParams.user_id}`,
        data,
        {
            removeOnComplete: {
                age: 24 * 3600,
                count: 500,
            },
        }
    );
};

const isBvnPayload = (
    payload: SmileIdWebhookData | BvnKycVerificationWebhookBody
): payload is BvnKycVerificationWebhookBody => {
    return payload.PartnerParams.job_id.startsWith(BVN_VERIFICATION_JOB_ID_PREFIX);
};

const extractFullName = (bvnData: BvnKycVerificationWebhookBody): string => {
    const bvnFirstName = bvnData.FullData?.FirstName;
    const bvnLastName = bvnData.FullData?.LastName;
    const bvnMiddleName = bvnData.FullData?.MiddleName;
    let bvnFullName = bvnData.FullName ?? '';

    if (!isValidStringData(bvnFullName ?? '')) {
        if (isValidStringData(bvnFirstName ?? '')) {
            bvnFullName += bvnFirstName + (bvnMiddleName ? ` ${bvnMiddleName}` : '');
        }
        if (isValidStringData(bvnLastName ?? '')) {
            bvnFullName += ` ${bvnLastName}`;
        }
    }

    return bvnFullName.trim();
};

const compareUserDataWithBvnData = (
    user: {
        firstName: string;
        lastName: string;
        kycDateOfBirth: string;
        country: string;
    },
    bvnData: BvnKycVerificationWebhookBody
) => {
    const bvnFirstName = bvnData.FullData?.FirstName;
    const bvnLastName = bvnData.FullData?.LastName;
    const bvnMiddleName = bvnData.FullData?.MiddleName;
    let bvnFullName = bvnData.FullName ?? '';

    if (!isValidStringData(bvnFullName ?? '')) {
        if (isValidStringData(bvnFirstName ?? '')) {
            bvnFullName += bvnFirstName + (bvnMiddleName ? ` ${bvnMiddleName}` : '');
        }
        if (isValidStringData(bvnLastName ?? '')) {
            bvnFullName += ` ${bvnLastName}`;
        }
    }

    const nameCheck =
        bvnFullName?.toLowerCase() === `${user.firstName} ${user.lastName}`.toLowerCase();
    const dobCheck = bvnData.DOB === user.kycDateOfBirth;
    const countryCheck = bvnData.Country?.toLowerCase() === user.country.toLowerCase();

    const errors: Array<{
        path: 'name' | 'dob' | 'country';
        message: string;
    }> = [];

    if (!nameCheck) {
        errors.push({
            path: 'name',
            message: `Name mismatch: "${bvnFullName}"(BVN data) doesn't match "${user.firstName} ${user.lastName}"(NIN data)`,
        });
    }

    if (!dobCheck) {
        errors.push({
            path: 'dob',
            message: `Date of birth mismatch: "${bvnData.DOB}"(BVN data) doesn't match "${user.kycDateOfBirth}"(NIN data)`,
        });
    }

    if (!countryCheck) {
        errors.push({
            path: 'country',
            message: `Country mismatch: "${bvnData.Country}" doesn't match "${user.country}"`,
        });
    }

    return {
        isTheSameUser: nameCheck && dobCheck && countryCheck,
        errors,
    };
};

const isValidStringData = (address: string): address is string => {
    if (address.trim() === '') return false;
    return address.toLowerCase() !== NOT_AVAILABLE.toLowerCase();
};

export const createKycEventJobWorker = () => {
    return new Worker<SmileIdWebhookData | BvnKycVerificationWebhookBody>(
        QueueNames.handleSmileKycWebhook,
        async (job) => {
            const webhookData = job.data;
            const user = await userServiceV2.getUserById(webhookData.PartnerParams.user_id);

            if (!user) {
                throw new Error('User not found');
            }

            if (isBvnPayload(webhookData)) {
                if (webhookData.ResultCode === KycWebhookResultCode.ID_VALIDATED) {
                    if (user.kycStatus?.toLowerCase() === 'in_review') {
                        if (
                            !user.firstName ||
                            !user.lastName ||
                            !user.kycDateOfBirth ||
                            !user.country
                        ) {
                            throw new Error('Expected user info to contain basic KYC info');
                        }

                        const userBioData = {
                            bvn: {
                                name: extractFullName(webhookData),
                                dateOfBirth: webhookData.DOB! ?? webhookData.FullData?.DateOfBirth!,
                            },
                            nin: {
                                name: `${user.firstName} ${user.lastName}`,
                                dateOfBirth: user.kycDateOfBirth,
                            },
                        };

                        const kycReviewResult = compareUserKycInfoWithDecision(userBioData);

                        if (kycReviewResult.decision === 'AUTO_APPROVE') {
                            const address = webhookData.Address;
                            await userServiceV2.updateUserInfo(user, {
                                kycStatus: 'VERIFIED',
                                additionalKycIdNumber: webhookData.IDNumber,
                                additionalKycIdType: webhookData.IDType,
                                address: isValidStringData(address ?? '')
                                    ? address?.trim()
                                    : undefined,
                            });
                            await WhatsAppBotService.sendKycVerifiedMessage(
                                user.primaryWhatsappPhoneNumber
                            );

                            return {
                                userBioData,
                                kycReviewResult,
                            };
                        }
                        if (kycReviewResult.decision === 'AUTO_REJECT') {
                            const messages = generateKycRejectMessages(
                                kycReviewResult,
                                userBioData,
                                user.primaryWhatsappPhoneNumber
                            );
                            const userMessageObj = MessageGenerators.generateTextMessage(
                                user.primaryWhatsappPhoneNumber,
                                messages.userMessage.message
                            );

                            await WhatsAppBotService.sendWhatsappMessage(
                                env.WA_PHONE_NUMBER_ID,
                                userMessageObj
                            );
                            await sendTechnicalIssueAlert(
                                messages.adminMessage.message,
                                env.WA_PHONE_NUMBER_ID
                            );

                            return {
                                userBioData,
                                kycReviewResult,
                            };
                        }
                        if (kycReviewResult.decision === 'MANUAL_REVIEW') {
                        }

                        const { isTheSameUser, errors } = compareUserDataWithBvnData(
                            {
                                firstName: user.firstName,
                                lastName: user.lastName,
                                kycDateOfBirth: user.kycDateOfBirth,
                                country: user.country,
                            },
                            webhookData
                        );

                        if (!isTheSameUser) {
                            const errorMessages = errors
                                .map((error) => `- ${error.message}`)
                                .join('\n');

                            const messageBody = `BVN verification failed.\n\nReasons:\n${errorMessages}\n\nPlease type and send /support to get help.`;

                            const message = MessageGenerators.generateTextMessage(
                                user.primaryWhatsappPhoneNumber,
                                messageBody
                            );

                            await WhatsAppBotService.sendWhatsappMessage(
                                env.WA_PHONE_NUMBER_ID,
                                message
                            );

                            throw new Error(errorMessages);
                        }

                        const address = webhookData.Address;

                        await userServiceV2.updateUserInfo(user, {
                            kycStatus: 'VERIFIED',
                            additionalKycIdNumber: webhookData.IDNumber,
                            additionalKycIdType: webhookData.IDType,
                            address: isValidStringData(address ?? '') ? address?.trim() : undefined,
                        });

                        await WhatsAppBotService.sendKycVerifiedMessage(
                            user.primaryWhatsappPhoneNumber
                        );
                    }

                    return;
                } else {
                    if (user.kycStatus?.toLowerCase() !== 'in_review') {
                        return;
                    }

                    const message = BvnKycVerificationFlow.withPhoneNumberId(
                        env.WA_PHONE_NUMBER_ID
                    ).createBvnVerificationFlowMessage(user, {
                        messageBody: `BVN verification failed.\n\nPlease confirm your BVN number and click on 'Try Again'`,
                        messageRecipient: user.primaryWhatsappPhoneNumber,
                        flowCTA: 'Try Again',
                        initialValues: {
                            email: user.email ?? undefined,
                        },
                    });

                    await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
                }

                return;
            }

            const kycResult = SmileIdService.gradeKycActions(webhookData.ResultCode);

            if (kycResult.status !== 'verified') {
                const message =
                    kycResult.status === 'rejected'
                        ? MessageGenerators.generateInteractiveCtaUrlButtonMessage({
                              recipient: user.primaryWhatsappPhoneNumber,
                              bodyText: `${kycResult.message}\n\nPlease click on the link below to retry.`,
                              headerText: `Submit KYC details`,
                              ctaUrl: await SmileIdService.generateKycLink(user.id),
                              ctaText: 'Retry KYC',
                          })
                        : MessageGenerators.generateTextMessage(
                              user.primaryWhatsappPhoneNumber,
                              kycResult.message
                          );

                const userInfoToUpdate = extractUserInfoToUpdate(webhookData, kycResult.status);

                await userServiceV2.updateUserInfo(user, userInfoToUpdate);

                await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);

                return kycResult;
            }

            const jobStatus = await SmileIdService.getJobStatus(
                webhookData.PartnerParams.user_id,
                webhookData.PartnerParams.job_id
            );

            const targetHistoryItem = jobStatus.history.find(
                (item) => item.ResultCode === KycWebhookResultCode.ID_VALIDATED
            );

            if (!targetHistoryItem) {
                throw new Error('ID validation history not found!');
            }

            await userServiceV2.updateUserInfo(
                user,
                extractUserInfoToUpdate(targetHistoryItem, kycResult.status)
            );

            if (targetHistoryItem.Country === NG) {
                const message = BvnKycVerificationFlow.withPhoneNumberId(
                    env.WA_PHONE_NUMBER_ID
                ).createBvnVerificationFlowMessage(user, {
                    messageBody:
                        'One last step to complete your KYC verification. Please verify your BVN.',
                    messageRecipient: user.primaryWhatsappPhoneNumber,
                    flowCTA: 'Verify BVN',
                });

                await WhatsAppBotService.sendWhatsappMessage(env.WA_PHONE_NUMBER_ID, message);
                return message;
            } else {
                await WhatsAppBotService.sendWhatsappMessage(
                    env.WA_PHONE_NUMBER_ID,
                    MessageGenerators.generateTextMessage(
                        user.primaryWhatsappPhoneNumber,
                        '🎉 Your KYC has been successfully verified!'
                    )
                );
                return {
                    userCountry: user.country,
                    kycResult,
                };
            }
        },
        {
            connection: connectionConfig,
            concurrency: 30,
        }
    );
};
