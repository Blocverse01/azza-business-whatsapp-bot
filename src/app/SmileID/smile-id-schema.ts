import { z } from 'zod';

export const VerificationWebhookBodySchema = z.object({
    Actions: z.object({
        Return_Personal_Info: z.string().optional(),
        Verify_ID_Number: z.string().optional(),
    }),
    Address: z.string().optional(),
    Country: z.string().optional(),
    DOB: z.string().optional(),
    ExpirationDate: z.string().optional(),
    FullName: z.string().optional(),
    Gender: z.string().optional(),
    IDNumber: z.string().optional(),
    IDType: z.string().optional(),
    IssuanceDate: z.string().optional(),
    PartnerParams: z.object({
        job_id: z.string(),
        job_type: z.number(),
        link_id: z.string(),
        user_id: z.string(),
    }),
    PhoneNumber: z.string().optional(),
    PhoneNumber2: z.string().optional(),
    ResultCode: z.string(),
    ResultText: z.string(),
    Secondary_ID_Number: z.string().optional(),
    signature: z.string(),
    SmileJobID: z.string(),
    Source: z.string().optional(),
    timestamp: z.string(),
    FullData: z
        .object({
            birthcountry: z.string(),
            birthdate: z.string(),
            centralID: z.string(),
            documentno: z.string(),
            educationallevel: z.string(),
            email: z.string(),
            employmentstatus: z.string(),
            firstname: z.string(),
            gender: z.string(),
            height: z.string(),
            maidenname: z.string(),
            message: z.string(),
            middlename: z.string(),
            nationality: z.string(),
            nin: z.string(),
            nok_address1: z.string(),
            nok_address2: z.string(),
            nok_firstname: z.string(),
            nok_lastname: z.string(),
            nok_lga: z.string(),
            nok_middlename: z.string(),
            nok_postalcode: z.string(),
            nok_state: z.string(),
            nok_town: z.string(),
            nspokenlang: z.string(),
            ospokenlang: z.string(),
            othername: z.string(),
            pfirstname: z.string(),
            place: z.string(),
            pmiddlename: z.string(),
            profession: z.string(),
            psurname: z.string(),
            residence_AddressLine1: z.string(),
            residence_AddressLine2: z.string(),
            residence_lga: z.string(),
            residence_state: z.string(),
            residence_town: z.string(),
            residencestatus: z.string(),
            self_origin_lga: z.string(),
            self_origin_place: z.string(),
            self_origin_state: z.string(),
            state: z.string(),
            success: z.boolean(),
            surname: z.string(),
            telephoneno: z.string(),
            title: z.string(),
            trackingId: z.string(),
            userid: z.string(),
            vNIN: z.string(),
        })
        .optional(),
});

export const BvnVerificationWebhookBodySchema = z.object({
    Actions: z.object({
        Return_Personal_Info: z.string(),
        Verify_ID_Number: z.string(),
    }),
    Address: z.string().optional(),
    Country: z.string(),
    DOB: z.string().optional(),
    Document: z.string().optional(),
    ExpirationDate: z.string().optional(),
    FullData: z
        .object({
            BVN: z.string(),
            DateOfBirth: z.string(),
            email: z.string(),
            enrollmentBank: z.string(),
            enrollmentBranch: z.string(),
            FirstName: z.string(),
            Gender: z.string(),
            ImageBase64: z.string(),
            LastName: z.string(),
            LevelOfAccount: z.string(),
            lgaOfOrigin: z.string(),
            lgaOfResidence: z.string(),
            maritalStatus: z.string(),
            message: z.string(),
            MiddleName: z.string(),
            nameOnCard: z.string(),
            nationality: z.string(),
            nin: z.string(),
            PhoneNumber1: z.string(),
            PhoneNumber2: z.string(),
            registrationDate: z.string(),
            residentialAddress: z.string(),
            stateOfOrigin: z.string(),
            stateOfResidence: z.string(),
            success: z.boolean(),
            title: z.string(),
            watchListed: z.string(),
        })
        .optional(),
    FullName: z.string().optional(),
    Gender: z.string().optional(),
    IDNumber: z.string(),
    IDType: z.string(),
    ImageLinks: z.object({ id_photo_image: z.string() }).optional(),
    IssuanceDate: z.string().optional(),
    PartnerParams: z.object({
        job_id: z.custom<`bvn_verify_${string}`>(),
        job_type: z.number(),
        user_id: z.string(),
    }),
    PhoneNumber: z.string().optional(),
    PhoneNumber2: z.string().optional(),
    Photo: z.string().optional(),
    ResultCode: z.string(),
    ResultText: z.string(),
    Secondary_ID_Number: z.string().optional(),
    signature: z.string(),
    SmileJobID: z.string(),
    Source: z.string().optional(),
    timestamp: z.string(),
});

export type SmileIdWebhookData = z.infer<typeof VerificationWebhookBodySchema>;
export type BvnKycVerificationWebhookBody = z.infer<typeof BvnVerificationWebhookBodySchema>;

export enum KycWebhookResultCode {
    ID_INVALID = '1013', // REJECTED
    ID_NOT_FOUND = '1023', // REJECTED
    SELFIE_TO_ID_CHECK_FAILED = '0811', // REJECTED
    HUMAN_SELFIE_TO_ID_CHECK_FAILED_MISMATCHED_IMAGES = '1211', // REJECTED
    HUMAN_SELFIE_TO_ID_CHECK_FAILED_POSSIBLE_FRAUD = '1212', // REJECTED
    NO_FACE_FOUND = '0911', // REJECTED
    POOR_IMAGE_QUALITY = '0912', // REJECTED
    SPOOF_DETECTED = '1242', // REJECTED

    SELFIE_TO_ID_CHECK_PASSED = '0810', // VERIFIED
    HUMAN_SELFIE_TO_ID_CHECK_PASSED = '1210', // VERIFIED
    SELFIE_TO_ID_CHECK_PASSED_2 = '0820', // VERIFIED

    ID_VALIDATED = '1012', //  IN_REVIEW
    PROVISIONALLY_APPROVED = '0815', //  IN_REVIEW
    SELFIE_TO_ID_CHECK_AWAITING = '0812', //  IN_REVIEW
    HUMAN_SELFIE_TO_ID_CHECK_AWAITING = '0814', //  IN_REVIEW
}

export const IN_REVIEW_RESULT_CODES = [
    KycWebhookResultCode.SELFIE_TO_ID_CHECK_AWAITING,
    KycWebhookResultCode.ID_VALIDATED,
    KycWebhookResultCode.HUMAN_SELFIE_TO_ID_CHECK_AWAITING,
    KycWebhookResultCode.PROVISIONALLY_APPROVED,
];
export const REJECTED_RESULT_CODES = [
    KycWebhookResultCode.ID_INVALID,
    KycWebhookResultCode.ID_NOT_FOUND,
    KycWebhookResultCode.SELFIE_TO_ID_CHECK_FAILED,
    KycWebhookResultCode.HUMAN_SELFIE_TO_ID_CHECK_FAILED_MISMATCHED_IMAGES,
    KycWebhookResultCode.HUMAN_SELFIE_TO_ID_CHECK_FAILED_POSSIBLE_FRAUD,
    KycWebhookResultCode.NO_FACE_FOUND,
    KycWebhookResultCode.POOR_IMAGE_QUALITY,
    KycWebhookResultCode.SPOOF_DETECTED,
];
export const VERIFIED_RESULT_CODES = [
    KycWebhookResultCode.SELFIE_TO_ID_CHECK_PASSED,
    KycWebhookResultCode.HUMAN_SELFIE_TO_ID_CHECK_PASSED,
    KycWebhookResultCode.SELFIE_TO_ID_CHECK_PASSED_2,
];
